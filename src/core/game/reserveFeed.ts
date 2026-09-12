/**
 * A held reserve of pieces released one at a time on a counted trigger, with
 * whatever remains released all at once at a declared match phase.
 *
 * ── Season-agnostic ────────────────────────────────────────────────────────
 *
 * Nothing here names NECTAR or a HIVE. BIOBUZZ's human player introduces one
 * reserve piece per HIVE tip and dumps the rest with a minute left; a
 * different season's manually-fed reserve, gated by a different counted event
 * or phase, is the same shape.
 *
 * ── Why a reserve rather than spawning new pieces ──────────────────────────
 *
 * The engine has no notion of a piece that does not yet exist: every game
 * piece is a real body from tick zero (ARCHITECTURE.md §9). A reserve piece
 * is therefore staged like any other and immediately parked — the same state
 * a conveyor holds a queued piece in — so the declared piece count for the
 * match never disagrees with what `GameDefinition.pieces` says exists. This
 * class only decides *when* a parked reserve piece is released, exactly the
 * way a human player decides when to walk NECTAR into the LOADING ZONE.
 *
 * ── What it does not do ─────────────────────────────────────────────────────
 *
 * It does not score, and it does not know what a trigger structure's tip
 * threshold is; it only reads how many times one has fired.
 */

import type { FieldZone } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { MatchState } from './matchStructure.js';

export interface ReserveFeedSpec {
  readonly id: string;
  /** Reserve piece ids, in the order they are released. */
  readonly pieceIds: readonly string[];
  /** Zone a released piece appears in, resting. */
  readonly spawnZoneId: string;
  /** Structure whose tip count gates this reserve (`game/tipper.ts`). */
  readonly triggerStructureId: string;
  /** Reserve pieces released per tip of the trigger structure. */
  readonly perTriggerCount: number;
  /**
   * Match state at which every remaining reserve piece is released at once,
   * regardless of trigger count. Omitted means the reserve only ever drains
   * through triggers.
   */
  readonly releaseAllAtState?: MatchState | undefined;
}

/** The narrow slice of the world a reserve feed writes to. */
export interface ReserveFeedWorld {
  releasePieceMoving(pieceId: string, positionM: Vec2, velocityM: Vec2): void;
}

interface FeedState {
  released: number;
  lastSeenTipCount: number;
  dumpedRemainder: boolean;
}

/** Runs every reserve feed a game declares. */
export class ReserveFeeds {
  private readonly states = new Map<string, FeedState>();

  constructor(
    private readonly specs: readonly ReserveFeedSpec[],
    private readonly places: ReadonlyMap<string, FieldZone>,
  ) {
    for (const spec of specs) {
      this.states.set(spec.id, { released: 0, lastSeenTipCount: 0, dumpedRemainder: false });
    }
  }

  /** Reserve pieces not yet released, in release order. */
  remaining(feedId: string): readonly string[] {
    const spec = this.specs.find((candidate) => candidate.id === feedId);
    const state = this.states.get(feedId);
    if (spec === undefined || state === undefined) return [];
    return spec.pieceIds.slice(state.released);
  }

  /**
   * Advance every feed one tick.
   *
   * @param tipCountOf Current tip count for a trigger structure id
   *   (`TippingStructures.tipCount`), read fresh each tick rather than
   *   through events so a feed created after a structure cannot miss tips
   *   that happened before it existed.
   */
  update(
    tipCountOf: (structureId: string) => number,
    matchState: MatchState,
    world: ReserveFeedWorld,
  ): void {
    for (const spec of this.specs) {
      const state = this.states.get(spec.id);
      const zone = this.places.get(spec.spawnZoneId);
      if (state === undefined || zone === undefined) continue;

      const tipCount = tipCountOf(spec.triggerStructureId);
      const newTips = Math.max(0, tipCount - state.lastSeenTipCount);
      if (newTips > 0) {
        state.lastSeenTipCount = tipCount;
        this.release(spec, state, zone, newTips * spec.perTriggerCount, world);
      }

      if (
        spec.releaseAllAtState !== undefined &&
        spec.releaseAllAtState === matchState &&
        !state.dumpedRemainder
      ) {
        state.dumpedRemainder = true;
        this.release(spec, state, zone, spec.pieceIds.length, world);
      }
    }
  }

  private release(
    spec: ReserveFeedSpec,
    state: FeedState,
    zone: FieldZone,
    count: number,
    world: ReserveFeedWorld,
  ): void {
    const upTo = Math.min(spec.pieceIds.length, state.released + count);
    for (let index = state.released; index < upTo; index++) {
      world.releasePieceMoving(spec.pieceIds[index] as string, zone.centerM, vec2(0, 0));
    }
    state.released = upTo;
  }
}

/**
 * Resolve every declared feed's spawn zone against a game's zones.
 *
 * Throws on a missing id, the same contract `resolveConveyorPlaces` holds.
 */
export function resolveReserveFeedPlaces(
  specs: readonly ReserveFeedSpec[],
  zones: readonly FieldZone[],
): ReadonlyMap<string, FieldZone> {
  const byId = new Map<string, FieldZone>();
  for (const zone of zones) byId.set(zone.id, zone);

  const resolved = new Map<string, FieldZone>();
  for (const spec of specs) {
    const zone = byId.get(spec.spawnZoneId);
    if (zone === undefined) {
      throw new Error(`Reserve feed "${spec.id}" needs zone "${spec.spawnZoneId}".`);
    }
    resolved.set(spec.spawnZoneId, zone);
  }
  return resolved;
}
