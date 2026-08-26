/**
 * Match structure (ARCHITECTURE.md §6.3).
 *
 * The load-bearing decision here: **endgame is a sub-phase of teleop, not a
 * third period.** An FTC match is 30 s autonomous plus 2:00 teleop, where the
 * last 30 s of teleop *is* endgame. `PRODUCT_SPEC.md` §2 lists three durations
 * as though they were additive; modelling that literally would produce a
 * three-minute match. This is the deliberate deviation recorded in
 * ARCHITECTURE.md §0.1.
 *
 * The type enforces it: `ENDGAME` can only exist inside `TELEOP`, and it is
 * positioned by *time remaining* rather than by a duration, so it cannot extend
 * the match no matter what value it holds.
 *
 * This module is types plus pure derivation over them. There is no clock, no
 * state machine and no event emission — those belong to the rules engine, which
 * is not part of this chunk.
 */

import type { Sourced } from './sourced.js';

export type PeriodId = 'AUTO' | 'TELEOP';
export type SubPhaseId = 'ENDGAME';
/** Any phase a scoring rule can be scoped to. */
export type PhaseId = PeriodId | SubPhaseId;
/** Phases plus the states either side of the match. */
/**
 * `TRANSITION` is the dead time between periods, and is deliberately its own
 * state rather than being folded into `PRE`.
 *
 * Conflating the two is wrong in a way that silently loses points: DECODE puts
 * an 8-second gap between AUTO and TELEOP and states that anything meeting
 * scoring criteria before TELEOP starts is assessed as AUTO (§10.5 A). Treating
 * that window as "before the match" made every artifact that settled in it
 * score nothing.
 *
 * Which period a transition scores as is a property of the game, so it is read
 * from `MatchStructure.transitionScoresAs` rather than assumed here.
 */
export type MatchState = 'PRE' | PhaseId | 'TRANSITION' | 'POST';

export interface EndgameSubPhase {
  readonly id: 'ENDGAME';
  /**
   * Seconds *remaining in teleop* when endgame begins. Expressing it this way
   * rather than as a duration is what makes it structurally impossible for
   * endgame to lengthen the match.
   */
  readonly startsAtRemainingSec: Sourced<number>;
}

export interface AutoPeriod {
  readonly id: 'AUTO';
  readonly durationSec: Sourced<number>;
}

export interface TeleopPeriod {
  readonly id: 'TELEOP';
  readonly durationSec: Sourced<number>;
  /** Exactly one sub-phase today; a tuple so the shape stays explicit. */
  readonly subPhases: readonly [EndgameSubPhase];
}

export interface MatchStructure {
  readonly periods: readonly [AutoPeriod, TeleopPeriod];
  /** Dead time between autonomous and teleop, if the game defines any. */
  readonly transitionSec?: Sourced<number> | undefined;
  /**
   * Which period an achievement during the transition is scored as.
   *
   * Omitted means the transition scores nothing, which is the safe default: a
   * game that has not said gets no points rather than points attributed to a
   * period it never named.
   */
  readonly transitionScoresAs?: Sourced<PeriodId> | undefined;
}

/** A phase and the window of match time it occupies. */
export interface PhaseWindow {
  readonly phase: PhaseId;
  readonly startSec: number;
  readonly endSec: number;
}

function autoOf(match: MatchStructure): AutoPeriod {
  return match.periods[0];
}

function teleopOf(match: MatchStructure): TeleopPeriod {
  return match.periods[1];
}

/**
 * Total match length.
 *
 * Auto + transition + teleop. Endgame contributes nothing, because it is inside
 * teleop — the property this whole module exists to guarantee.
 */
export function totalMatchDurationSec(match: MatchStructure): number {
  return (
    autoOf(match).durationSec.value +
    (match.transitionSec?.value ?? 0) +
    teleopOf(match).durationSec.value
  );
}

/** Absolute match time at which teleop begins. */
export function teleopStartSec(match: MatchStructure): number {
  return autoOf(match).durationSec.value + (match.transitionSec?.value ?? 0);
}

/**
 * Absolute match time at which endgame begins.
 *
 * Clamped into teleop: an endgame threshold longer than teleop itself would
 * otherwise start before teleop does, and a negative one would start after the
 * match ends. Both are authoring errors the schema also rejects, but the
 * derivation must not produce nonsense if one slips through.
 */
export function endgameStartSec(match: MatchStructure): number {
  const teleop = teleopOf(match);
  const remaining = teleop.subPhases[0].startsAtRemainingSec.value;
  const clamped = Math.min(Math.max(remaining, 0), teleop.durationSec.value);
  return teleopStartSec(match) + (teleop.durationSec.value - clamped);
}

/**
 * The match broken into non-overlapping windows, in order.
 *
 * Teleop appears as the segment *before* endgame rather than spanning it, so
 * the windows tile the match exactly once. Endgame is still teleop for any rule
 * scoped to `TELEOP` — see `isWithinPhase`.
 */
export function matchTimeline(match: MatchStructure): readonly PhaseWindow[] {
  const auto = autoOf(match);
  const teleopStart = teleopStartSec(match);
  const endgameStart = endgameStartSec(match);
  const end = totalMatchDurationSec(match);

  const windows: PhaseWindow[] = [
    { phase: 'AUTO', startSec: 0, endSec: auto.durationSec.value },
  ];

  if (endgameStart > teleopStart) {
    windows.push({ phase: 'TELEOP', startSec: teleopStart, endSec: endgameStart });
  }
  windows.push({ phase: 'ENDGAME', startSec: endgameStart, endSec: end });

  return windows;
}

/** Match state at an absolute time, in seconds from the start of autonomous. */
export function matchStateAt(match: MatchStructure, timeSec: number): MatchState {
  if (timeSec < 0) return 'PRE';
  if (timeSec >= totalMatchDurationSec(match)) return 'POST';

  const auto = autoOf(match);
  if (timeSec < auto.durationSec.value) return 'AUTO';
  if (timeSec < teleopStartSec(match)) return 'TRANSITION';
  return timeSec >= endgameStartSec(match) ? 'ENDGAME' : 'TELEOP';
}

/**
 * The *period* a state belongs to, as distinct from the phase.
 *
 * `ENDGAME` belongs to `TELEOP`, because it is a sub-phase inside it. The
 * distinction matters for end-of-period assessment: crossing TELEOP → ENDGAME
 * does **not** end teleop, so a rule assessing "where the robot finished" must
 * not fire there. Teleop ends only when the period does, at ENDGAME → POST.
 *
 * Returns `null` outside the match.
 */
export function periodOf(state: MatchState): PeriodId | null {
  if (state === 'AUTO') return 'AUTO';
  if (state === 'TELEOP' || state === 'ENDGAME') return 'TELEOP';
  // TRANSITION is deliberately not a period. A period *ends* when its clock
  // does — DECODE assesses LEAVE "at the end of AUTO" (§10.5 E), not at the end
  // of the settling window that follows it — so end-of-period assessment fires
  // at AUTO -> TRANSITION. What the transition *scores as* is a separate
  // question, answered by `scoringStateAt`.
  return null;
}

/**
 * The phase a rule should be scoped against at this moment.
 *
 * Differs from `matchStateAt` only during a transition, where the clock is in
 * dead time but the game may still attribute achievements to the period that
 * just ended. Returns `null` when nothing scores.
 */
export function scoringStateAt(match: MatchStructure, timeSec: number): MatchState | null {
  const state = matchStateAt(match, timeSec);
  if (state === 'PRE' || state === 'POST') return null;
  if (state !== 'TRANSITION') return state;
  return match.transitionScoresAs?.value ?? null;
}

/**
 * Whether a rule scoped to `phase` applies at this match state.
 *
 * The asymmetry that matters: **endgame counts as teleop**, because it is part
 * of it. A rule scoped to `TELEOP` fires during endgame; a rule scoped to
 * `ENDGAME` does not fire during ordinary teleop.
 */
export function isWithinPhase(state: MatchState, phase: PhaseId | 'ANY'): boolean {
  if (phase === 'ANY') return state === 'AUTO' || state === 'TELEOP' || state === 'ENDGAME';
  if (state === 'PRE' || state === 'POST' || state === 'TRANSITION') return false;
  if (phase === 'TELEOP') return state === 'TELEOP' || state === 'ENDGAME';
  return state === phase;
}

/**
 * Conventional FTC match timing: 30 s autonomous, 2:00 teleop, endgame in the
 * final 30 s.
 *
 * Marked `assumed` rather than `explicit` on purpose. These values have held for
 * many seasons but they are *rules*, and a real `GameDefinition` must take them
 * from that season's manual. Shipping them as `explicit` would be exactly the
 * silent invention PRODUCT_SPEC.md §3 forbids.
 */
export const FTC_CONVENTIONAL_MATCH: MatchStructure = {
  periods: [
    {
      id: 'AUTO',
      durationSec: {
        value: 30,
        confidence: 'assumed',
        note: 'Conventional FTC autonomous length; confirm against the season manual.',
      },
    },
    {
      id: 'TELEOP',
      durationSec: {
        value: 120,
        confidence: 'assumed',
        note: 'Conventional FTC teleop length; confirm against the season manual.',
      },
      subPhases: [
        {
          id: 'ENDGAME',
          startsAtRemainingSec: {
            value: 30,
            confidence: 'assumed',
            note: 'Endgame conventionally occupies the final 30 s of teleop.',
          },
        },
      ],
    },
  ],
};
