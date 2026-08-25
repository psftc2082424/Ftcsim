/**
 * Effects — the only channel from game rules back to the world
 * (ARCHITECTURE.md §3.2, §6.4).
 *
 * Rules are pure: they read events and return a list of effects. They never hold
 * a reference to a body, never mutate a pose, and never call into physics. The
 * simulation applies effects afterwards.
 *
 * The union is **closed** on purpose. Every way a game is permitted to change
 * the world is enumerable in one place and reviewable in one sitting. A rule
 * that wants a new kind of world change requires a new variant here — a
 * deliberate, visible act — rather than reaching into the simulation.
 */

export type EffectKind =
  | 'consumePiece'
  | 'attachPiece'
  | 'detachPiece'
  | 'teleportPiece'
  | 'setPieceRegion'
  | 'setVariable';

/** Remove a piece from play, e.g. a scored piece swallowed by a goal. */
export interface ConsumePieceEffect {
  readonly kind: 'consumePiece';
  readonly pieceId: string;
}

/** Give possession of a piece to a robot. */
export interface AttachPieceEffect {
  readonly kind: 'attachPiece';
  readonly pieceId: string;
  readonly robotId: string;
}

export interface DetachPieceEffect {
  readonly kind: 'detachPiece';
  readonly pieceId: string;
}

/** Move a piece to a field position, e.g. a human-player return. */
export interface TeleportPieceEffect {
  readonly kind: 'teleportPiece';
  readonly pieceId: string;
  readonly xIn: number;
  readonly yIn: number;
}

/**
 * Record a piece as occupying a logical region, optionally at an ordered slot.
 *
 * Games routinely track a piece as "on the ramp, third from the gate" — a
 * logical position that no rigid body expresses. This is how a game maintains
 * that bookkeeping without inventing physics.
 */
export interface SetPieceRegionEffect {
  readonly kind: 'setPieceRegion';
  readonly pieceId: string;
  readonly regionId: string;
  readonly slotIndex?: number | undefined;
}

/** Set a per-match variable, e.g. the randomised pattern for this match. */
export interface SetVariableEffect {
  readonly kind: 'setVariable';
  readonly name: string;
  readonly value: string | number | boolean;
}

export type Effect =
  | ConsumePieceEffect
  | AttachPieceEffect
  | DetachPieceEffect
  | TeleportPieceEffect
  | SetPieceRegionEffect
  | SetVariableEffect;

/**
 * Exhaustiveness helper.
 *
 * Applying effects must handle every variant. Routing the default branch through
 * this makes a new variant a compile error at every application site rather than
 * a silently ignored effect at runtime.
 */
export function assertNeverEffect(effect: never): never {
  throw new Error(`Unhandled effect: ${JSON.stringify(effect)}`);
}

export interface ScoreDelta {
  readonly alliance: 'red' | 'blue';
  readonly points: number;
  /** Rule that awarded it, for an auditable score breakdown. */
  readonly ruleId: string;
  readonly label: string;
  readonly tick: number;
}

export interface ScoreState {
  readonly red: number;
  readonly blue: number;
  /** Every award in order, so a final score can always be explained. */
  readonly deltas: readonly ScoreDelta[];
}

export const EMPTY_SCORE: ScoreState = Object.freeze({
  red: 0,
  blue: 0,
  deltas: Object.freeze([]),
});

export function applyScoreDeltas(
  score: ScoreState,
  deltas: readonly ScoreDelta[],
): ScoreState {
  if (deltas.length === 0) return score;

  let red = score.red;
  let blue = score.blue;
  for (const delta of deltas) {
    if (delta.alliance === 'red') red += delta.points;
    else blue += delta.points;
  }

  return { red, blue, deltas: [...score.deltas, ...deltas] };
}

/** Points contributed by each rule, for the post-match breakdown. */
export function scoreBreakdown(
  score: ScoreState,
  alliance: 'red' | 'blue',
): Readonly<Record<string, number>> {
  const breakdown: Record<string, number> = {};
  for (const delta of score.deltas) {
    if (delta.alliance !== alliance) continue;
    breakdown[delta.ruleId] = (breakdown[delta.ruleId] ?? 0) + delta.points;
  }
  return breakdown;
}
