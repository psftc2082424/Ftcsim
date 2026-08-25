/**
 * Controller interface.
 *
 * A controller is a pure function of tick and world state, `(tick, snapshot) =>
 * ControlInput`. Sources that are inherently stateful — a keyboard, a gamepad —
 * keep their state outside `core/` and simply report the current value when
 * sampled.
 *
 * This is the seam that lets scripted traces, metric probes and replays drive
 * the identical simulation path a human does. It is deliberately *not* a
 * programming language: PRODUCT_SPEC.md §15 defers Java/FTC SDK execution, and
 * nothing here executes user code.
 *
 * The `WorldSnapshot` import is type-only, so `control/` and `sim/` have no
 * runtime dependency on each other in either direction.
 */

import type { ControlInput } from './controlInput.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

export interface Controller {
  readonly id: string;
  sample(tick: number, snapshot: WorldSnapshot): ControlInput;
}

/** A controller that never commands anything. Useful as a placeholder robot. */
export class NeutralController implements Controller {
  readonly id = 'neutral';

  sample(): ControlInput {
    return NEUTRAL;
  }
}

const NEUTRAL: ControlInput = {
  drive: { x: 0, y: 0, turn: 0 },
  buttons: {},
  axes: {},
};

/**
 * Controller backed by a mutable slot, written from outside the simulation.
 *
 * This is how live input reaches the sim: DOM listeners in `app/` write the
 * latest value, and the sim reads whatever is current when it ticks. The sim
 * never blocks on input and input never drives the sim clock.
 */
export class LatchedController implements Controller {
  private current: ControlInput = NEUTRAL;

  constructor(readonly id: string = 'latched') {}

  set(input: ControlInput): void {
    this.current = input;
  }

  sample(): ControlInput {
    return this.current;
  }
}
