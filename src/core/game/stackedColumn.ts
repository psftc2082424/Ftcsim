/**
 * Vertical columns that stack pieces in arrival order, sort them by size, and
 * report what is standing inside a declared scoring band.
 *
 * ── Season-agnostic ────────────────────────────────────────────────────────
 *
 * Nothing here names a FLOWER, a POLLEN or a NECTAR. A column is a point on
 * the field, a set of heights, and three per-piece-type lookups declared as
 * data: how low each type may seat, which types confer ownership, and which
 * types may be drawn back out of the bottom. BIOBUZZ's FLOWER is four
 * instances of it; a different season's silo or magazine could be another.
 *
 * ── Why a sorter ring is one number per piece type ─────────────────────────
 *
 * A real scoring tube can have a restriction part-way up whose hole passes one
 * size of element and stops another. That single fact — "this type cannot sink
 * below this height" — is the whole mechanism: an element the ring stops always
 * seats at or above it, so it is always at or above the bottom of the scoring
 * band, while a smaller element falls straight past to whatever is underneath.
 * Expressing it as `seatFloorMByPieceType` rather than as a modelled annulus
 * keeps it a property of the *column's* data, not of the engine.
 *
 * ── What the pieces actually are ───────────────────────────────────────────
 *
 * A stacked piece is held by the field (`ColumnWorld.holdPieceAt`), exactly the
 * way a conveyor's queue holds one: still a body, still drawn, still counted,
 * but not integrated and not colliding — because this engine's contact solver
 * is planar and a column is several pieces at one (x, y). The one exception is
 * the bottom-most piece when its type is retrievable: it is put back into play
 * *at the column's own base*, pinned there every tick, so an ordinary ROBOT
 * intake can draw it out with no new robot-facing action. A type the retrieval
 * opening cannot pass is never presented, which is what locks a column.
 *
 * ── What it does not do ────────────────────────────────────────────────────
 *
 * It does not score. It emits `PieceStackedInColumn` and `ColumnAssessed`, the
 * same one-way physics-to-rules channel every other fact uses
 * (ARCHITECTURE.md §3.2); rules decide what a stack is worth.
 */

import type { FieldRegion } from './regions.js';
import { distance, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot, PieceSnapshot } from '../sim/snapshot.js';
import type { Alliance, ColumnAssessedEvent, PieceStackedInColumnEvent, SimEvent } from './events.js';

export interface StackedColumnSpec {
  readonly id: string;
  /** The region this column scores through; also where its centre is read from. */
  readonly regionId: string;
  /**
   * How far from the column's centre a descending piece may be and still drop
   * in. This is the mouth, not the region: a region may be drawn wider than
   * the real opening for legibility.
   */
  readonly entryRadiusM: number;
  /** Height of the entry ring at the top of the tube. */
  readonly entryHeightM: number;
  /**
   * How far above the entry ring a descending piece still counts as entering.
   *
   * A lobbed piece crosses the ring's height between two fixed steps, so the
   * test needs a band rather than an exact height. Below the ring it reaches
   * one radius, which is the point at which the piece is unambiguously in.
   */
  readonly entryMarginM: number;
  /** Height the lowest piece in the column rests its underside on. */
  readonly floorHeightM: number;
  /** Band a piece must at least partly occupy to count as scoring. */
  readonly scoringBandM: { readonly bottomM: number; readonly topM: number };
  /**
   * Lowest underside height each piece type may seat at — the sorter ring.
   * A type absent from this map falls all the way to `floorHeightM`.
   */
  readonly seatFloorMByPieceType: Readonly<Record<string, number>>;
  /**
   * Alliance a piece type confers on the column while it is in the scoring
   * band. A type absent from this map confers nothing, however many of it the
   * column holds.
   */
  readonly ownershipByPieceType: Readonly<Record<string, Alliance>>;
  /** Piece types the bottom opening is wide enough to pass back out. */
  readonly retrievablePieceTypes: readonly string[];
  /** Piece ids already stacked at match start, bottom first. */
  readonly initialPieceIds?: readonly string[] | undefined;
}

/** The narrow slice of the world a column writes to. */
export interface ColumnWorld {
  /** Park a piece at a point and a height, held by the field mechanism. */
  holdPieceAt(pieceId: string, positionM: Vec2, heightM: number): void;
  /** Put a parked piece back into play, at rest, at a point. */
  releasePiece(pieceId: string, positionM: Vec2): void;
  /** End the collision-free flight a routed shot travels under. */
  completePieceTransfer(pieceId: string): void;
}

/** One piece's computed place in a column. */
export interface StackedPiece {
  readonly pieceId: string;
  readonly pieceType: string;
  /** Index from the bottom of the column. */
  readonly stackIndex: number;
  /** Centre height above the floor. */
  readonly centerHeightM: number;
  readonly radiusM: number;
}

interface ColumnState {
  /** Piece ids, bottom first. */
  readonly pieceIds: string[];
  primed: boolean;
}

/**
 * Where each piece in a column seats, bottom to top.
 *
 * Each piece rests on the one below it, except that a piece its own sorter
 * ring stops can never seat below that ring — `max(columnTop, seatFloor)`. The
 * column top then advances to the top of the piece *as seated*, not past
 * whatever it skipped over: a stopped piece occupies `seat … seat + 2r`, and
 * what rests on it starts there. Advancing from the old top instead would
 * leave a phantom gap the size of the clearance underneath it.
 */
export function stackedPieces(
  spec: StackedColumnSpec,
  entries: readonly { readonly pieceId: string; readonly pieceType: string; readonly radiusM: number }[],
): readonly StackedPiece[] {
  const out: StackedPiece[] = [];
  let topM = spec.floorHeightM;
  entries.forEach((entry, stackIndex) => {
    const seatM = Math.max(topM, spec.seatFloorMByPieceType[entry.pieceType] ?? spec.floorHeightM);
    out.push({
      pieceId: entry.pieceId,
      pieceType: entry.pieceType,
      stackIndex,
      centerHeightM: seatM + entry.radiusM,
      radiusM: entry.radiusM,
    });
    topM = seatM + entry.radiusM * 2;
  });
  return out;
}

/** Is a piece at this centre height at least partly inside the scoring band? */
export function inScoringBand(spec: StackedColumnSpec, centerHeightM: number, radiusM: number): boolean {
  return (
    centerHeightM + radiusM > spec.scoringBandM.bottomM &&
    centerHeightM - radiusM < spec.scoringBandM.topM
  );
}

/** How tall the column stands: the top of its highest piece, or its own floor. */
export function stackTopM(spec: StackedColumnSpec, stacked: readonly StackedPiece[]): number {
  const highest = stacked[stacked.length - 1];
  return highest === undefined ? spec.floorHeightM : highest.centerHeightM + highest.radiusM;
}

/**
 * Would one more piece fit under the entry ring?
 *
 * The new piece's underside would seat at the current top (or at its own
 * sorter ring, whichever is higher), and it fits while that seat is still
 * below the ring — its radius cancels out of the comparison, which is why this
 * needs the type and not the size.
 */
export function columnAccepts(
  spec: StackedColumnSpec,
  stacked: readonly StackedPiece[],
  pieceType: string,
): boolean {
  const seatM = Math.max(
    stackTopM(spec, stacked),
    spec.seatFloorMByPieceType[pieceType] ?? spec.floorHeightM,
  );
  return seatM < spec.entryHeightM;
}

/**
 * How many pieces of one type an empty column holds.
 *
 * Filled through `columnAccepts` rather than divided out of the height,
 * because a sorter ring makes the seats something other than evenly spaced: a
 * stopped type's first piece is lifted to the ring, and that clearance can
 * cost the column a whole piece. A capacity helper with its own copy of the
 * stacking rule would not know.
 */
export function columnCapacity(spec: StackedColumnSpec, pieceType: string, radiusM: number): number {
  const entries: { pieceId: string; pieceType: string; radiusM: number }[] = [];
  // Bounded so a nonsensical spec (a zero-radius piece, a ring above the
  // entry) cannot spin here rather than failing a definition check.
  while (entries.length < CAPACITY_SEARCH_LIMIT) {
    const stacked = stackedPieces(spec, entries);
    if (!columnAccepts(spec, stacked, pieceType)) break;
    entries.push({ pieceId: `probe-${entries.length}`, pieceType, radiusM });
  }
  return entries.length;
}

const CAPACITY_SEARCH_LIMIT = 64;

/** Runs every stacked column a game declares. */
export class StackedColumns {
  private readonly states = new Map<string, ColumnState>();

  constructor(private readonly specs: readonly StackedColumnSpec[]) {
    for (const spec of specs) {
      this.states.set(spec.id, { pieceIds: [], primed: false });
    }
  }

  /** Piece ids currently stacked in a column, bottom first. */
  contents(columnId: string): readonly string[] {
    return this.states.get(columnId)?.pieceIds ?? [];
  }

  /**
   * Advance every column one tick: let go of what has been retrieved, take in
   * whatever has dropped through the entry ring, and hold the rest in place.
   */
  update(regions: ReadonlyMap<string, FieldRegion>, snapshot: WorldSnapshot, world: ColumnWorld): void {
    const byId = new Map(snapshot.pieces.map((piece) => [piece.pieceId, piece]));
    const claimed = new Set<string>();
    for (const state of this.states.values()) {
      for (const pieceId of state.pieceIds) claimed.add(pieceId);
    }

    for (const spec of this.specs) {
      const state = this.states.get(spec.id);
      const region = regions.get(spec.regionId);
      if (state === undefined || region === undefined) continue;

      if (!state.primed) {
        // Staged contents join the column before anything else can claim them,
        // so a match starts with the column the setup guide describes rather
        // than with a heap of loose pieces at one point.
        for (const pieceId of spec.initialPieceIds ?? []) {
          if (byId.has(pieceId) && !claimed.has(pieceId)) {
            state.pieceIds.push(pieceId);
            claimed.add(pieceId);
          }
        }
        state.primed = true;
      }

      // A piece a ROBOT has taken has left the column. So has one that no
      // longer exists at all, which keeps a stale id from holding a slot.
      for (let index = state.pieceIds.length - 1; index >= 0; index--) {
        const pieceId = state.pieceIds[index] as string;
        const piece = byId.get(pieceId);
        if (piece === undefined || piece.heldByRobotId !== null) {
          state.pieceIds.splice(index, 1);
          claimed.delete(pieceId);
        }
      }

      for (const piece of snapshot.pieces) {
        if (claimed.has(piece.pieceId)) continue;
        if (piece.heldByRobotId !== null) continue;
        if (!entersColumn(spec, region, piece)) continue;
        if (!columnAccepts(spec, this.stackOf(spec, state, byId), piece.pieceType)) continue;
        state.pieceIds.push(piece.pieceId);
        claimed.add(piece.pieceId);
        // Caught: whatever brought it here — a routed shot's protected flight,
        // a drop — is over, and the column owns it from now on.
        if (piece.transferring === true) world.completePieceTransfer(piece.pieceId);
      }

      this.placeContents(spec, region, state, byId, world);
    }
  }

  /**
   * Restate every column's contents as facts, for end-of-period assessment.
   *
   * One `PieceStackedInColumn` per piece standing in the scoring band, each
   * carrying the alliance the column's *highest* owning piece confers, plus
   * one `ColumnAssessed` carrying the alliance its *lowest* owning piece
   * confers. Two event kinds rather than one because they are two different
   * owners: a rule awards per scoring piece to the first and once to the
   * second, and `evaluateRules` resolves exactly one alliance per event.
   */
  assess(
    regions: ReadonlyMap<string, FieldRegion>,
    snapshot: WorldSnapshot,
    tick: number,
    timeSec: number,
  ): readonly SimEvent[] {
    const byId = new Map(snapshot.pieces.map((piece) => [piece.pieceId, piece]));
    const events: SimEvent[] = [];

    for (const spec of this.specs) {
      const state = this.states.get(spec.id);
      if (state === undefined || !regions.has(spec.regionId)) continue;

      const stacked = this.stackOf(spec, state, byId);
      const scoring = stacked.filter((piece) => inScoringBand(spec, piece.centerHeightM, piece.radiusM));
      const owning = scoring.flatMap((piece) => {
        const alliance = spec.ownershipByPieceType[piece.pieceType];
        return alliance === undefined ? [] : [{ piece, alliance }];
      });
      const topOwner = owning[owning.length - 1]?.alliance;
      const bottomOwner = owning[0]?.alliance;

      for (const piece of scoring) {
        const event: PieceStackedInColumnEvent = {
          kind: 'PieceStackedInColumn',
          tick,
          timeSec,
          columnId: spec.id,
          regionId: spec.regionId,
          pieceId: piece.pieceId,
          pieceType: piece.pieceType,
          stackIndex: piece.stackIndex,
          heightM: piece.centerHeightM,
          ...(topOwner === undefined ? {} : { alliance: topOwner }),
        };
        events.push(event);
      }

      const assessed: ColumnAssessedEvent = {
        kind: 'ColumnAssessed',
        tick,
        timeSec,
        columnId: spec.id,
        regionId: spec.regionId,
        scoringCount: scoring.length,
        ...(bottomOwner === undefined ? {} : { alliance: bottomOwner }),
      };
      events.push(assessed);
    }

    return events;
  }

  private stackOf(
    spec: StackedColumnSpec,
    state: ColumnState,
    byId: ReadonlyMap<string, PieceSnapshot>,
  ): readonly StackedPiece[] {
    return stackedPieces(
      spec,
      state.pieceIds.flatMap((pieceId) => {
        const piece = byId.get(pieceId);
        return piece === undefined
          ? []
          : [{ pieceId, pieceType: piece.pieceType, radiusM: piece.radiusM }];
      }),
    );
  }

  /**
   * Hold every stacked piece where the stack says it is.
   *
   * The bottom-most piece is presented instead of parked when its type can
   * pass the retrieval opening: it goes back into play at the column's base
   * and is pinned there every tick, so an ordinary intake can take it and
   * nothing else can move it. A type the opening cannot pass is parked like
   * the rest, which is what makes it lock the column.
   */
  private placeContents(
    spec: StackedColumnSpec,
    region: FieldRegion,
    state: ColumnState,
    byId: ReadonlyMap<string, PieceSnapshot>,
    world: ColumnWorld,
  ): void {
    const stacked = this.stackOf(spec, state, byId);
    stacked.forEach((piece, index) => {
      const presented =
        index === 0 && spec.retrievablePieceTypes.includes(piece.pieceType);
      if (presented) world.releasePiece(piece.pieceId, region.centerM);
      else world.holdPieceAt(piece.pieceId, region.centerM, piece.centerHeightM);
    });
  }
}

/**
 * Is this loose piece dropping in through the column's entry ring?
 *
 * Top entry only, and all three conditions matter: near the centre in plan,
 * moving downward, and at the ring's own height. A piece rolling past on the
 * floor satisfies the first and fails the other two, which is what keeps a
 * column from swallowing whatever a ROBOT pushes across its base.
 */
function entersColumn(spec: StackedColumnSpec, region: FieldRegion, piece: PieceSnapshot): boolean {
  if (piece.verticalVelocityMps >= 0) return false;
  if (distance(piece.pose.p, region.centerM) > spec.entryRadiusM) return false;
  return (
    piece.heightM >= spec.entryHeightM - piece.radiusM &&
    piece.heightM <= spec.entryHeightM + spec.entryMarginM
  );
}

/**
 * Resolve every declared column's region against a game's regions.
 *
 * Throws on a missing id rather than silently doing nothing, the same contract
 * `resolveTippingRegions` holds: a column pointing at a region that does not
 * exist is a definition error.
 */
export function resolveColumnRegions(
  specs: readonly StackedColumnSpec[],
  regions: readonly FieldRegion[],
): ReadonlyMap<string, FieldRegion> {
  const byId = new Map<string, FieldRegion>();
  for (const region of regions) byId.set(region.id, region);

  const resolved = new Map<string, FieldRegion>();
  for (const spec of specs) {
    const region = byId.get(spec.regionId);
    if (region === undefined) {
      throw new Error(`Stacked column "${spec.id}" needs region "${spec.regionId}".`);
    }
    resolved.set(spec.regionId, region);
  }
  return resolved;
}
