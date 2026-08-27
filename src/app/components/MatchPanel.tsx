/**
 * Live match state: the phase, the clock, the score, and what just scored.
 *
 * This is the game layer made visible. Everything below is read from the
 * `GameDefinition` the runner is playing, and nothing in this file names a
 * DECODE rule, region or point value — the labels come off the awards
 * themselves, so a different season renders here with no change.
 *
 * Re-renders at the telemetry rate, never at frame or tick rate.
 */

import type { GameDefinition } from '../../core/game/gameDefinition.js';
import type { MatchStatus } from '../simRunner.js';
import { totalMatchDurationSec } from '../../core/game/matchStructure.js';

interface Props {
  readonly game: GameDefinition;
  readonly status: MatchStatus | null;
}

/** `mm:ss`, the way a match clock is read. Exported so it can be tested
 *  without a DOM: an off-by-one in a clock is a real bug and this file is
 *  otherwise pure presentation. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Time left in the current period, which is what a driver actually watches.
 *
 * Derived from the structure rather than tracked separately, so a game with
 * different periods needs no change here.
 */
export function remainingLabel(game: GameDefinition, status: MatchStatus): string {
  const total = totalMatchDurationSec(game.match);
  return clock(total - status.matchTimeSec);
}

export function MatchPanel({ game, status }: Props) {
  const phase = status?.state.replace('_', ' ') ?? 'PRE-MATCH';
  return (
    <section className="match-overlay" aria-label="Match scoreboard">
      <div className="match-side red"><span>RED</span><strong>{status?.red ?? 0}</strong></div>
      <div className="match-centre"><span className="match-phase">{phase}</span><strong>{status === null ? '—:——' : remainingLabel(game, status)}</strong>{status?.recentAwards[0] !== undefined && <small>{status.recentAwards[0].label} +{status.recentAwards[0].points}</small>}</div>
      <div className="match-side blue"><strong>{status?.blue ?? 0}</strong><span>BLUE</span></div>
    </section>
  );
}
