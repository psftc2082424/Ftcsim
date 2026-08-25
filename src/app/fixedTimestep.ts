/**
 * Fixed-timestep accumulator.
 *
 * Converts irregular frame deltas into whole simulation steps. This is the piece
 * that makes "render frequency must never affect physics" true: the simulation
 * only ever advances in exact `dt` increments, and whatever time is left over
 * carries into the next frame.
 *
 * Extracted from `SimRunner` so the behaviour can be tested without a browser —
 * it is the one bit of the app layer whose correctness the whole simulation
 * depends on.
 */

export class FixedTimestepAccumulator {
  private accumulator = 0;

  constructor(
    readonly dt: number,
    /**
     * Longest frame gap honoured, in seconds. A backgrounded tab returns with a
     * multi-second delta; without a clamp the loop would try to catch up
     * thousands of ticks in one frame, take longer than a frame to do it, and
     * fall further behind every time. Clamping drops the missed time instead:
     * simulated time may lag wall time, but the loop never spirals.
     */
    readonly maxFrameSeconds: number,
  ) {
    if (!(dt > 0)) throw new Error(`dt must be positive, got ${dt}.`);
    if (!(maxFrameSeconds >= dt)) {
      throw new Error(`maxFrameSeconds (${maxFrameSeconds}) must be at least one dt (${dt}).`);
    }
  }

  /** Absorb a frame delta and report how many whole steps to run. */
  advance(frameSeconds: number): number {
    // NaN is unorderable garbage and becomes zero. An infinite delta is still
    // orderable, so the ordinary clamp handles it: +Inf becomes one maximum
    // frame, -Inf becomes zero.
    const usable = Number.isNaN(frameSeconds)
      ? 0
      : Math.min(Math.max(frameSeconds, 0), this.maxFrameSeconds);

    this.accumulator += usable;

    // Divide once rather than subtracting `dt` in a loop. Repeated subtraction
    // accumulates floating-point error: 0.25 s of pending time at dt = 5 ms
    // yields 49 steps instead of 50, and an exact multiple of dt can leave a
    // residual just under dt so the final step is silently dropped.
    const steps = Math.floor(this.accumulator / this.dt);
    if (steps > 0) {
      this.accumulator -= steps * this.dt;
      // Guard against a tiny negative residual from the subtraction above.
      if (this.accumulator < 0) this.accumulator = 0;
    }
    return steps;
  }

  /**
   * How far the current frame sits between the last two steps, in [0, 1).
   * The renderer interpolates by this so motion looks smooth at any frame rate.
   */
  get alpha(): number {
    return this.accumulator / this.dt;
  }

  /** Leftover time not yet consumed by a step, in seconds. */
  get pending(): number {
    return this.accumulator;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
