/**
 * Bistable field structures: two fixed places, one "up" at a time, that flip
 * when enough resting pieces accumulate in the up one.
 *
 * ── Season-agnostic ────────────────────────────────────────────────────────
 *
 * Nothing here names a HIVE or a CELL. A structure is two regions and a
 * threshold, declared as data on a `GameDefinition`. BIOBUZZ's HIVE is one
 * instance of it per alliance; a different season's seesaw or dispenser could
 * be another.
 *
 * ── Why a load threshold, not real hinge physics ───────────────────────────
 *
 * A bistable structure tips on accumulated torque, so what it balances is
 * *weight*, not a headcount: BIOBUZZ's own field is calibrated to tip on
 * either of two loads that weigh the same but hold different numbers of balls
 * (8 POLLEN, or 3 POLLEN + 3 NECTAR). A structure therefore declares the mass
 * one cell must carry, and this weighs whatever is resting in the up cell
 * against it. Modelling the hinge itself would need a pivot geometry no manual
 * publishes; the load is the part that is published, and it is the part the
 * rule actually turns on.
 *
 * ── Why the swing takes time ───────────────────────────────────────────────
 *
 * Reaching the threshold starts a *swing*; the cells swap when it finishes.
 * A real structure this size takes seconds to come over, and an instant flip
 * both looked wrong and removed the only window in which a driver can see a
 * tip coming. The swing is still not hinge physics: it is one declared
 * duration scaled by how far past its own threshold the load is (see
 * `tipDurationAtThresholdSec`), which is the cheapest relationship that gets
 * the one behaviour a heavier load should have — it comes over sooner.
 *
 * ── What it does not do ────────────────────────────────────────────────────
 *
 * It does not score. It emits `StructureTipped`, the same one-way channel
 * every other physics-to-rules fact uses (ARCHITECTURE.md §3.2); a rule
 * decides what a tip is worth.
 */

import { regionContains, type FieldRegion } from './regions.js';
import { length, normalize, rotate, scale, sub, vec2, type Vec2 } from '../math/vec2.js';
import { SubStream, type Pcg32, type SubStreamId } from '../math/rng.js';
import type { WorldSnapshot } from '../sim/snapshot.js';
import type { Alliance, StructureTippedEvent } from './events.js';
import type { Sourced } from './sourced.js';

export interface TippingStructureSpec {
  readonly id: string;
  readonly alliance: Alliance;
  /** The two fixed regions a piece can rest in; exactly one is up at a time. */
  readonly cellRegionIds: readonly [string, string];
  /** Index into `cellRegionIds` that is up-facing at the start of a match. */
  readonly initialUpIndex: 0 | 1;
  /**
   * Mass resting in the up cell that flips the structure, kilograms.
   *
   * Reached exactly, not exceeded: a cell holding this much tips, which is how
   * a calibration stated as "tips on the 8th POLLEN" is expressed.
   */
  readonly tipThresholdMassKg: Sourced<number>;
  /**
   * How long the swing takes when the cell holds exactly its threshold load,
   * seconds.
   *
   * A heavier load comes over faster, in inverse proportion to how far past
   * the threshold it is: `duration = base * threshold / load`. Inverse rather
   * than linear-in-excess because it needs no second constant and cannot
   * reach zero however heavy the load gets — a structure that snapped over
   * instantly above some load would be back to the instant flip this replaced.
   * The duration is fixed at the moment the swing starts and is not
   * re-evaluated as pieces settle during it, so a tip that has begun always
   * completes at a knowable time.
   */
  readonly tipDurationAtThresholdSec: Sourced<number>;
  /** Height above the floor a resting piece is held at while its cell is up. */
  readonly cellRestHeightM: number;
  /** Vertical approach rate toward `cellRestHeightM`, m/s. */
  readonly cellHeightRateMps: number;
  /**
   * Nominal horizontal speed a dumped piece leaves with when its cell flips
   * down. Each piece draws its own speed and direction around this nominal
   * value and the cell's own dump axis (`dumpScatter`), so a multi-piece dump
   * scatters rather than flying off as one uniform block.
   */
  readonly dumpSpeedMps: number;
}

/**
 * How far a dumped piece's exit velocity is allowed to wander from the
 * nominal `dumpSpeedMps` and the cell's own dump direction.
 *
 * Not a rule — real balls tumbling out of a tipped cell do not all leave on
 * the same line at the same speed, and a uniform push reads as an obviously
 * synthetic "slide" rather than a dump. The direction itself still comes from
 * the cells' real geometry (`dumpDirection` below), so this only adds the
 * per-piece variety.
 */
const DUMP_SPEED_JITTER = 0.7;
const DUMP_ANGLE_SPREAD_RAD = (75 * Math.PI) / 180;

/**
 * The direction dumped pieces travel: continuing outward, past the cell that
 * just went down, along the real axis between the two cells.
 *
 * Deriving this from the cells' own positions — rather than a fixed world
 * axis — is what makes a dump travel along whichever way the structure's two
 * cells are actually arranged. A HIVE whose CELLs sit front-to-back dumps
 * front-to-back; one arranged side-to-side would dump side-to-side. Nothing
 * here assumes which.
 */
function dumpDirection(nowDownCenterM: Vec2, nowUpCenterM: Vec2): Vec2 {
  const axis = sub(nowDownCenterM, nowUpCenterM);
  return length(axis) > 1e-9 ? normalize(axis) : vec2(1, 0);
}

/** The narrow slice of the world a tipping structure writes to. */
export interface TippingWorld {
  guidePiece(
    pieceId: string,
    accelerationMps2: Vec2,
    targetHeightM?: number,
    heightRateMps?: number,
    velocityDampingPerSec?: number,
  ): void;
  setPieceVelocity(pieceId: string, velocityM: Vec2): void;
  /**
   * End the collision-free flight a routed shot travels under.
   *
   * A cell that has caught a piece is the end of that piece's transfer: from
   * here it rests, tips and falls as an ordinary body. Without this a shot
   * stays a ghost that never collides again, because nothing else in a game
   * without conveyors ever clears the flag.
   */
  completePieceTransfer(pieceId: string): void;
  /** A seeded sub-stream, so a dump's scatter is replayable rather than ambient entropy. */
  rng(stream: SubStreamId): Pcg32;
}

interface StructureState {
  upIndex: 0 | 1;
  tipCount: number;
  /** Match time the current swing completes at, or `null` when at rest. */
  swingEndsAtSec: number | null;
  /** Match time the current swing began at; meaningless while at rest. */
  swingStartedAtSec: number;
  /** 0 at rest, rising to 1 across a swing. Read by presentation only. */
  swingProgress: number;
}

/**
 * How long a swing takes for a given load.
 *
 * Exported so a caller can state the expectation directly rather than
 * recomputing the relationship, and so the one place that knows it is the one
 * place a test reads.
 */
export function tipDurationSec(spec: TippingStructureSpec, loadKg: number): number {
  const threshold = spec.tipThresholdMassKg.value;
  const base = spec.tipDurationAtThresholdSec.value;
  if (loadKg <= threshold) return base;
  return (base * threshold) / loadKg;
}

/** One milligram: far below any scoring element, far above summation error. */
const LOAD_EPSILON_KG = 1e-6;

/**
 * Runs every bistable structure a game declares.
 *
 * Owned by the match simulation beside the conveyors: both are stateful
 * readers of the snapshot that write back through a narrow interface rather
 * than reaching into bodies.
 */
export class TippingStructures {
  private readonly states = new Map<string, StructureState>();

  constructor(private readonly specs: readonly TippingStructureSpec[]) {
    for (const spec of specs) {
      this.states.set(spec.id, {
        upIndex: spec.initialUpIndex,
        tipCount: 0,
        swingEndsAtSec: null,
        swingStartedAtSec: 0,
        swingProgress: 0,
      });
    }
  }

  /** Every structure this game declares, in declaration order. */
  get structureIds(): readonly string[] {
    return this.specs.map((spec) => spec.id);
  }

  /** The two cells this structure alternates between, in index order. */
  cellRegionIds(structureId: string): readonly [string, string] | undefined {
    return this.specs.find((spec) => spec.id === structureId)?.cellRegionIds;
  }

  /** Which of `cellRegionIds` is currently up. */
  upIndex(structureId: string): 0 | 1 | undefined {
    return this.states.get(structureId)?.upIndex;
  }

  /** The region id currently accepting pieces for this structure, or `undefined` if unknown. */
  currentUpRegionId(structureId: string): string | undefined {
    const spec = this.specs.find((candidate) => candidate.id === structureId);
    const state = this.states.get(structureId);
    if (spec === undefined || state === undefined) return undefined;
    return spec.cellRegionIds[state.upIndex];
  }

  /** How many times this structure has tipped so far in the match. */
  tipCount(structureId: string): number {
    return this.states.get(structureId)?.tipCount ?? 0;
  }

  /** Is this structure part-way through a swing right now? */
  isTipping(structureId: string): boolean {
    return this.states.get(structureId)?.swingEndsAtSec !== null;
  }

  /**
   * How far through its swing this structure is, 0 to 1; 0 while at rest.
   *
   * Presentation state, not a gameplay fact: a renderer showing which cell is
   * coming up needs the swing to read as in-progress, and nothing in the rules
   * pipeline consumes this.
   */
  tipProgress(structureId: string): number {
    return this.states.get(structureId)?.swingProgress ?? 0;
  }

  /**
   * Advance every structure one tick.
   *
   * Order within a structure: hold whatever is currently resting in the up
   * cell at its declared height, then weigh it. Weighing after holding means a
   * piece that arrives and completes the load on the same tick is already
   * accounted for.
   */
  update(
    regions: ReadonlyMap<string, FieldRegion>,
    snapshot: WorldSnapshot,
    tick: number,
    timeSec: number,
    world: TippingWorld,
  ): readonly StructureTippedEvent[] {
    const events: StructureTippedEvent[] = [];

    for (const spec of this.specs) {
      const state = this.states.get(spec.id);
      if (state === undefined) continue;

      const upRegion = regions.get(spec.cellRegionIds[state.upIndex]);
      if (upRegion === undefined) continue;

      const restingInUpCell: string[] = [];
      let loadKg = 0;
      for (const piece of snapshot.pieces) {
        if (piece.heldByRobotId !== null) continue;
        if (!regionContains(upRegion, piece.pose.p, piece.heightM)) continue;
        restingInUpCell.push(piece.pieceId);
        loadKg += piece.massKg;
        // Caught: whatever got it here — a shot's protected flight, a drop —
        // is over, and it is an ordinary body resting in a cell from now on.
        if (piece.transferring === true) world.completePieceTransfer(piece.pieceId);
        world.guidePiece(piece.pieceId, vec2(0, 0), spec.cellRestHeightM, spec.cellHeightRateMps);
      }

      if (state.swingEndsAtSec === null) {
        // Floating-point tolerance, not a fudge: a load declared as a whole
        // number of balls is summed one ball at a time, so the count that is
        // meant to tip can land a few ULPs short of its own threshold.
        if (loadKg < spec.tipThresholdMassKg.value - LOAD_EPSILON_KG) continue;

        // Loaded past its threshold: the structure starts coming over. Nothing
        // else changes this tick — the cells have not swapped, and whatever is
        // in the up cell stays held there by the guidance above until the
        // swing finishes.
        state.swingStartedAtSec = timeSec;
        state.swingEndsAtSec = timeSec + tipDurationSec(spec, loadKg);
        state.swingProgress = 0;
        continue;
      }

      const swingSec = state.swingEndsAtSec - state.swingStartedAtSec;
      if (timeSec < state.swingEndsAtSec) {
        state.swingProgress = swingSec > 0 ? (timeSec - state.swingStartedAtSec) / swingSec : 1;
        continue;
      }

      // The swing has completed: the held cell is now past vertical, so it
      // dumps whatever it is still holding and the other cell becomes the new
      // up-facing (and now empty) destination.
      state.swingEndsAtSec = null;
      state.swingProgress = 0;
      const nowDownCenterM = upRegion.centerM;
      state.upIndex = state.upIndex === 0 ? 1 : 0;
      state.tipCount += 1;

      const nowUpRegion = regions.get(spec.cellRegionIds[state.upIndex]);
      const baseDirection = dumpDirection(nowDownCenterM, nowUpRegion?.centerM ?? nowDownCenterM);
      const rng = world.rng(SubStream.GamePiece);

      for (const pieceId of restingInUpCell) {
        // Each piece gets its own direction and speed around the cell's real
        // dump axis, so a multi-piece dump scatters instead of sliding off as
        // one uniform block. Nothing holds their height after this tick, so
        // they fall from the cell's own resting height under ordinary gravity
        // once this velocity carries them clear of it.
        const angle = (rng.nextFloat() * 2 - 1) * DUMP_ANGLE_SPREAD_RAD;
        const speedFactor = 1 + (rng.nextFloat() * 2 - 1) * DUMP_SPEED_JITTER;
        const velocity = scale(rotate(baseDirection, angle), spec.dumpSpeedMps * speedFactor);
        world.setPieceVelocity(pieceId, velocity);
      }

      events.push({
        kind: 'StructureTipped',
        tick,
        timeSec,
        structureId: spec.id,
        alliance: spec.alliance,
        upRegionId: spec.cellRegionIds[state.upIndex],
      });
    }

    return events;
  }
}

/**
 * Resolve every declared structure's cell regions against a game's regions.
 *
 * Throws on a missing id rather than silently doing nothing, the same
 * contract `resolveConveyorPlaces` holds: a structure pointing at a region
 * that does not exist is a definition error.
 */
export function resolveTippingRegions(
  specs: readonly TippingStructureSpec[],
  regions: readonly FieldRegion[],
): ReadonlyMap<string, FieldRegion> {
  const byId = new Map<string, FieldRegion>();
  for (const region of regions) byId.set(region.id, region);

  const resolved = new Map<string, FieldRegion>();
  for (const spec of specs) {
    for (const regionId of spec.cellRegionIds) {
      const region = byId.get(regionId);
      if (region === undefined) {
        throw new Error(`Tipping structure "${spec.id}" needs region "${regionId}".`);
      }
      resolved.set(regionId, region);
    }
  }
  return resolved;
}
