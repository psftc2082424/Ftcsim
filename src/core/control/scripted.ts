/**
 * Deterministic scripted input.
 *
 * Two forms, both reproducible from data alone:
 *
 *   - `ScriptedController` replays a recorded `InputTrace` — a sparse list of
 *     tick-indexed changes. Because the simulation is deterministic, a trace
 *     plus a seed *is* a complete replay: a few kilobytes for a full match
 *     rather than a state dump (ARCHITECTURE.md §4.6).
 *
 *   - `ProgramController` evaluates a plain function of tick. This is what
 *     drives analytic reference tests ("full throttle for four seconds") and,
 *     in Phase 5, the headless metric probes.
 */

import { NEUTRAL_INPUT, clampControlInput, type ControlInput } from './controlInput.js';
import type { Controller } from './controller.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

export interface InputKeyframe {
  /** Tick at which this input takes effect and holds until the next keyframe. */
  readonly tick: number;
  readonly input: ControlInput;
}

export interface InputTrace {
  readonly id: string;
  /** Ascending by tick. Validated on construction. */
  readonly keyframes: readonly InputKeyframe[];
}

export function createInputTrace(id: string, keyframes: readonly InputKeyframe[]): InputTrace {
  for (let i = 1; i < keyframes.length; i++) {
    const previous = keyframes[i - 1] as InputKeyframe;
    const current = keyframes[i] as InputKeyframe;
    if (current.tick <= previous.tick) {
      throw new Error(
        `Input trace "${id}" keyframes must ascend by tick; ` +
          `saw ${previous.tick} then ${current.tick}.`,
      );
    }
  }
  if (keyframes.length > 0 && (keyframes[0] as InputKeyframe).tick < 0) {
    throw new Error(`Input trace "${id}" cannot start before tick 0.`);
  }
  return { id, keyframes };
}

/**
 * Replays an `InputTrace`. Holds the most recent keyframe's value, so a trace
 * describes changes rather than every tick.
 */
export class ScriptedController implements Controller {
  private cursor = 0;
  private held: ControlInput = NEUTRAL_INPUT;
  private lastTick = -1;

  constructor(
    private readonly trace: InputTrace,
    readonly id: string = `scripted:${trace.id}`,
  ) {}

  sample(tick: number): ControlInput {
    // Seeking backwards would mean the sim rewound; restart the scan so the
    // controller stays a pure function of tick rather than of call history.
    if (tick < this.lastTick) this.reset();
    this.lastTick = tick;

    const frames = this.trace.keyframes;
    while (this.cursor < frames.length && (frames[this.cursor] as InputKeyframe).tick <= tick) {
      this.held = (frames[this.cursor] as InputKeyframe).input;
      this.cursor++;
    }
    return this.held;
  }

  reset(): void {
    this.cursor = 0;
    this.held = NEUTRAL_INPUT;
    this.lastTick = -1;
  }
}

/** Input as a plain function of tick and world state. */
export class ProgramController implements Controller {
  constructor(
    private readonly program: (tick: number, snapshot: WorldSnapshot) => ControlInput,
    readonly id: string = 'program',
  ) {}

  sample(tick: number, snapshot: WorldSnapshot): ControlInput {
    return clampControlInput(this.program(tick, snapshot));
  }
}

/** Constant input for the whole run — the workhorse of the reference tests. */
export function constantController(input: ControlInput, id = 'constant'): Controller {
  const held = clampControlInput(input);
  return { id, sample: () => held };
}
