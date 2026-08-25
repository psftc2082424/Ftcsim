/**
 * Match clock.
 *
 * Advances a `MatchStructure` tick by tick and emits `PhaseChanged` when the
 * state changes. It has no clock of its own: it is driven by the simulation's
 * integer tick counter, so a match is exactly as deterministic as the physics
 * (ARCHITECTURE.md §9.1).
 *
 * Phase-end assessment is *not* special-cased here. The clock emits transitions;
 * rules that assess something at the end of a period simply trigger on
 * `PhaseChanged`. That keeps "score LEAVE at the end of AUTO" a property of the
 * GameDefinition rather than of the engine.
 */

import type { PhaseChangedEvent } from './events.js';
import {
  matchStateAt,
  totalMatchDurationSec,
  type MatchState,
  type MatchStructure,
} from './matchStructure.js';

export interface MatchClockOptions {
  readonly structure: MatchStructure;
  /** Seconds per tick. Supplied by the simulation, never assumed. */
  readonly dtSec: number;
}

export class MatchClock {
  private tickCount = 0;
  private state: MatchState;

  constructor(private readonly options: MatchClockOptions) {
    if (!(options.dtSec > 0)) {
      throw new Error(`MatchClock needs a positive timestep, got ${options.dtSec}.`);
    }
    this.state = matchStateAt(options.structure, 0);
  }

  get tick(): number {
    return this.tickCount;
  }

  /** Elapsed match time, derived from the tick counter. */
  get timeSec(): number {
    return this.tickCount * this.options.dtSec;
  }

  get currentState(): MatchState {
    return this.state;
  }

  get isRunning(): boolean {
    return this.state === 'AUTO' || this.state === 'TELEOP' || this.state === 'ENDGAME';
  }

  get isFinished(): boolean {
    return this.state === 'POST';
  }

  /** Seconds left in the whole match, floored at zero. */
  get remainingSec(): number {
    return Math.max(0, totalMatchDurationSec(this.options.structure) - this.timeSec);
  }

  /**
   * Advance one tick.
   *
   * Returns a `PhaseChanged` event when the state changed on this tick, or
   * `null` when it did not. Returning the event rather than pushing it keeps the
   * clock free of any dependency on an event bus.
   */
  advance(): PhaseChangedEvent | null {
    this.tickCount++;
    const next = matchStateAt(this.options.structure, this.timeSec);

    if (next === this.state) return null;

    const event: PhaseChangedEvent = {
      kind: 'PhaseChanged',
      tick: this.tickCount,
      timeSec: this.timeSec,
      from: this.state,
      to: next,
    };
    this.state = next;
    return event;
  }

  /** Restart at tick zero. */
  reset(): void {
    this.tickCount = 0;
    this.state = matchStateAt(this.options.structure, 0);
  }

  /** Total ticks in a full match, for headless runs. */
  totalTicks(): number {
    return Math.ceil(totalMatchDurationSec(this.options.structure) / this.options.dtSec);
  }
}

/**
 * Every phase transition a match will produce, without running a simulation.
 *
 * Used by tests and by headless scoring runs that need to drive the rules engine
 * through a match without physics.
 */
export function phaseTransitions(
  structure: MatchStructure,
  dtSec: number,
): readonly PhaseChangedEvent[] {
  const clock = new MatchClock({ structure, dtSec });
  const events: PhaseChangedEvent[] = [];

  const total = clock.totalTicks();
  for (let i = 0; i < total; i++) {
    const event = clock.advance();
    if (event !== null) events.push(event);
  }
  return events;
}
