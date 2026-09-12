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
 * ── What it does not do ────────────────────────────────────────────────────
 *
 * It does not score. It emits `StructureTipped`, the same one-way channel
 * every other physics-to-rules fact uses (ARCHITECTURE.md §3.2); a rule
 * decides what a tip is worth.
 */

import { regionContains, type FieldRegion } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
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
  /** Height above the floor a resting piece is held at while its cell is up. */
  readonly cellRestHeightM: number;
  /** Vertical approach rate toward `cellRestHeightM`, m/s. */
  readonly cellHeightRateMps: number;
  /** Horizontal speed a dumped piece leaves with when its cell flips down. */
  readonly dumpSpeedMps: number;
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
}

interface StructureState {
  upIndex: 0 | 1;
  tipCount: number;
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
      this.states.set(spec.id, { upIndex: spec.initialUpIndex, tipCount: 0 });
    }
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

      // Floating-point tolerance, not a fudge: a load declared as a whole
      // number of balls is summed one ball at a time, so the count that is
      // meant to tip can land a few ULPs short of its own threshold.
      if (loadKg < spec.tipThresholdMassKg.value - LOAD_EPSILON_KG) continue;

      // Tip: the held cell flips down and dumps whatever it was holding, and
      // the other cell becomes the new up-facing (and now empty) destination.
      state.upIndex = state.upIndex === 0 ? 1 : 0;
      state.tipCount += 1;

      for (const pieceId of restingInUpCell) {
        // A small, fixed outward push scatters dumped pieces instead of
        // stacking them exactly where the cell held them; it is cosmetic, not
        // a rule, so it does not need a seeded draw. Nothing holds their
        // height after this tick, so they fall out of the cell under gravity.
        world.setPieceVelocity(pieceId, vec2(spec.dumpSpeedMps, 0));
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
