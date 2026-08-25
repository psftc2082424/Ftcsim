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

export type SimEventKind =
  | 'PieceEnteredRegion'
  | 'PieceExitedRegion'
  | 'PieceReleasedBy'
  | 'PieceCameToRest'
  | 'RobotEnteredZone'
  | 'RobotExitedZone'
  | 'RobotOverlapsZone'
  | 'RobotHeightExceeded'
  | 'MechanismStateChanged'
  | 'PhaseChanged';

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

/** A robot let go of a piece. */
export interface PieceReleasedByEvent extends SimEventBase {
  readonly kind: 'PieceReleasedBy';
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
  | PieceReleasedByEvent
  | PieceCameToRestEvent
  | RobotZoneEvent
  | RobotHeightExceededEvent
  | MechanismStateChangedEvent
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
