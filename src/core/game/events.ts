/**
 * Simulation event model (ARCHITECTURE.md §3.2, §6.4).
 *
 * Events are the *only* channel from physics to game rules. Physics publishes
 * facts — "this piece came to rest in this region" — and never computes score.
 * Rules consume facts and never touch bodies. That one-way channel is what keeps
 * the two layers separable across seasons.
 *
 * Every event kind here is deliberately generic. Nothing names an ARTIFACT, a
 * DEPOT or a RAMP: those are DECODE's words, and they belong in a
 * GameDefinition's region ids, not in the engine's vocabulary. A season is
 * expressed by *which regions exist and which rules watch them*.
 *
 * Events carry the tick they occurred on so a rules engine can be replayed
 * deterministically from an event log alone.
 */

/**
 * Every event kind, as data.
 *
 * The union is derived from this array rather than written alongside it, so a
 * new event kind cannot be added to one and forgotten in the other. That
 * mattered: the schema in `schema/gameDefinition.schema.ts` kept its own hand
 * written copy of this list, drifted, and ended up rejecting 46 of the 54 rules
 * the DECODE fixture ships — a validator that could not express the definitions
 * this repository already runs.
 */
export const SIM_EVENT_KINDS = [
  'PieceEnteredRegion',
  'PieceExitedRegion',
  'PiecePossessed',
  'PossessionSustained',
  'PieceReleasedBy',
  'PieceLaunched',
  'PieceCameToRest',
  'RobotEnteredZone',
  'RobotExitedZone',
  'RobotOverlapsZone',
  'RobotHeightExceeded',
  'MechanismStateChanged',
  'RobotAssessed',
  'PhaseChanged',
] as const;

export type SimEventKind = (typeof SIM_EVENT_KINDS)[number];

export type Alliance = 'red' | 'blue';

export interface SimEventBase {
  readonly kind: SimEventKind;
  /** Simulation tick on which the fact became true. */
  readonly tick: number;
  /** Derived from the tick, never from a wall clock. */
  readonly timeSec: number;
}

/** A game piece crossed into a named region of the field. */
export interface PieceEnteredRegionEvent extends SimEventBase {
  readonly kind: 'PieceEnteredRegion';
  readonly pieceId: string;
  readonly pieceType: string;
  readonly regionId: string;
  /** Robot responsible, when attributable. */
  readonly byRobotId?: string | undefined;
  readonly byAlliance?: Alliance | undefined;
}

export interface PieceExitedRegionEvent extends SimEventBase {
  readonly kind: 'PieceExitedRegion';
  readonly pieceId: string;
  readonly pieceType: string;
  readonly regionId: string;
}

/**
 * A robot took possession of a piece.
 *
 * Generic on purpose. The engine has no opinion on what possession *means* for a
 * given season — DECODE calls it CONTROL and defines it in its glossary, other
 * games say "carrying" or "herding" — so the detector that produces this decides
 * from geometry and the rules decide what it is worth.
 */
export interface PiecePossessedEvent extends SimEventBase {
  readonly kind: 'PiecePossessed';
  readonly pieceId: string;
  readonly pieceType: string;
  readonly robotId: string;
  readonly alliance: Alliance;
  /**
   * Pieces this robot holds now, counting this one.
   *
   * Carried on the event so a possession-limit rule is an ordinary filtered
   * rule — "fires when the count reaches 4" — rather than something needing a
   * predicate with its own view of the world.
   */
  readonly possessedCount: number;
}

/**
 * A robot has held a given number of pieces long enough for it to be deliberate.
 *
 * Fires once per count reached in a possession episode, and only after the count
 * has stood for longer than the tracker's sustained threshold. That delay is the
 * whole point: momentary possession is indistinguishable from driving through a
 * cluster of pieces, so a rule about how many a robot may hold has to be able to
 * ask for possession that persisted (ASSUMPTIONS.md §10.14).
 *
 * Levels are reported cumulatively — a robot that reaches four sustained emits
 * one, two, three and four — so a rule that fines "per piece over the limit"
 * fires once per excess piece without the engine knowing what the limit is.
 */
export interface PossessionSustainedEvent extends SimEventBase {
  readonly kind: 'PossessionSustained';
  readonly robotId: string;
  readonly alliance: Alliance;
  readonly possessedCount: number;
  readonly heldSec: number;
}

/** A robot let go of a piece. */
export interface PieceReleasedByEvent extends SimEventBase {
  readonly kind: 'PieceReleasedBy';
  readonly pieceId: string;
  readonly pieceType: string;
  readonly robotId: string;
  readonly alliance: Alliance;
  /** Pieces this robot still holds, after letting this one go. */
  readonly possessedCount: number;
}

/** A robot intentionally launched a piece through a declared mechanism action. */
export interface PieceLaunchedEvent extends SimEventBase {
  readonly kind: 'PieceLaunched';
  readonly pieceId: string;
  readonly pieceType: string;
  readonly robotId: string;
  readonly alliance: Alliance;
}

/**
 * A piece stopped moving. Several games assess scoring only once pieces settle,
 * so this is distinct from merely entering a region.
 */
export interface PieceCameToRestEvent extends SimEventBase {
  readonly kind: 'PieceCameToRest';
  readonly pieceId: string;
  readonly pieceType: string;
  /** Regions the piece is resting in, innermost last. */
  readonly regionIds: readonly string[];
  /**
   * Ordered slot within the region, where the region is a sequence. Games that
   * score an ordered pattern need position, not just membership.
   */
  readonly slotIndex?: number | undefined;
}

export interface RobotZoneEvent extends SimEventBase {
  readonly kind: 'RobotEnteredZone' | 'RobotExitedZone' | 'RobotOverlapsZone';
  readonly robotId: string;
  readonly alliance: Alliance;
  readonly zoneId: string;
  /** Fraction of the robot's support inside the zone, 0–1, where known. */
  readonly supportFraction?: number | undefined;
}

export interface RobotHeightExceededEvent extends SimEventBase {
  readonly kind: 'RobotHeightExceeded';
  readonly robotId: string;
  readonly alliance: Alliance;
  readonly heightIn: number;
  readonly limitIn: number;
}

export interface MechanismStateChangedEvent extends SimEventBase {
  readonly kind: 'MechanismStateChanged';
  readonly robotId: string;
  readonly alliance: Alliance;
  readonly mechanismId: string;
  readonly state: string;
}

/**
 * A robot exists and is being assessed at a moment of consequence.
 *
 * Zone events only fire for zones a robot is *in*, which cannot express a rule
 * about where a robot is **not**. DECODE's LEAVE is exactly that: a robot scores
 * when it "is no longer over any LAUNCH LINE at the end of AUTO" (§10.5.3), and
 * a robot that has left produces no zone event at all to trigger on.
 *
 * So an assessment restates each robot as a bare fact at a period boundary, and
 * predicates answer questions about it. Season-agnostic: it asserts nothing
 * beyond "this robot is here now".
 */
export interface RobotAssessedEvent extends SimEventBase {
  readonly kind: 'RobotAssessed';
  readonly robotId: string;
  readonly alliance: Alliance;
}

/**
 * The match clock moved between phases.
 *
 * This is what lets end-of-period assessment be an ordinary rule rather than a
 * special case in the engine. DECODE assesses LEAVE at the end of AUTO and BASE,
 * DEPOT and PATTERN at the end of TELEOP; all four are rules triggered by this
 * event.
 */
export interface PhaseChangedEvent extends SimEventBase {
  readonly kind: 'PhaseChanged';
  readonly from: string;
  readonly to: string;
}

export type SimEvent =
  | PieceEnteredRegionEvent
  | PieceExitedRegionEvent
  | PiecePossessedEvent
  | PossessionSustainedEvent
  | PieceReleasedByEvent
  | PieceLaunchedEvent
  | PieceCameToRestEvent
  | RobotZoneEvent
  | RobotHeightExceededEvent
  | MechanismStateChangedEvent
  | RobotAssessedEvent
  | PhaseChangedEvent;

/**
 * Read a dotted path off an event for rule filtering.
 *
 * Filters address event fields by name so a GameDefinition can say "regionId
 * equals red-ramp" without the engine knowing what a ramp is. Returns
 * `undefined` for a missing path, which a filter treats as "does not match"
 * rather than as an error — a rule watching for a field this event kind does not
 * carry simply does not fire.
 */
export function readEventField(event: SimEvent, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = event;

  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    // A definition is data, and in Phase 4 it is generated. Own properties only:
    // a path that walked the prototype chain would read something no event
    // carries, and the schema rejecting it is not a reason for this to trust it.
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Ordering for deterministic replay: by tick, then by kind, then by identity. */
export function compareEvents(a: SimEvent, b: SimEvent): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;

  const aKey = JSON.stringify(a);
  const bKey = JSON.stringify(b);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}
