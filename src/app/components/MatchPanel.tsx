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
  return (
    <section className="panel">
      <h2>Match</h2>

      <div className="telemetry-row">
        <span className="telemetry-label">Game</span>
        <span className="telemetry-value">{game.name}</span>
      </div>

      {status === null ? (
        <p className="muted small">Waiting for the first tick.</p>
      ) : (
        <>
          <div className="telemetry-row">
            <span className="telemetry-label">Phase</span>
            <span className="telemetry-value">{status.state}</span>
          </div>
          <div className="telemetry-row">
            <span className="telemetry-label">Elapsed</span>
            <span className="telemetry-value">{clock(status.matchTimeSec)}</span>
          </div>
          <div className="telemetry-row">
            <span className="telemetry-label">Remaining</span>
            <span className="telemetry-value">{remainingLabel(game, status)}</span>
          </div>

          <h3>Score</h3>
          <div className="match-score">
            <span className="match-score-red">{status.red}</span>
            <span className="match-score-divider">–</span>
            <span className="match-score-blue">{status.blue}</span>
          </div>

          <h3>Recent awards</h3>
          {status.recentAwards.length === 0 ? (
            <p className="muted small">Nothing scored yet.</p>
          ) : (
            <ul className="match-awards">
              {status.recentAwards.map((award, index) => (
                // Awards are a rolling window rather than a keyed collection,
                // and the same rule can appear twice, so position is the key.
                <li key={`${award.ruleId}-${index}`} className={`match-award ${award.alliance}`}>
                  <span className="match-award-label">{award.label}</span>
                  <span className="match-award-points">+{award.points}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
