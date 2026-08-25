import { describe, expect, it } from 'vitest';
import { FixedTimestepAccumulator } from './fixedTimestep.js';
import { DT_SECONDS } from '../core/sim/simWorld.js';

const MAX_FRAME = 0.25;

describe('fixed timestep — render rate must not affect physics', () => {
  /**
   * The central guarantee of the loop. Whatever frame rate the display runs at,
   * the same wall-clock interval must produce the same number of simulation
   * steps.
   */
  it('produces the same step count at 30, 60 and 144 fps', () => {
    const totalSeconds = 5;

    const stepsAt = (fps: number): number => {
      const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
      const frameSeconds = 1 / fps;
      let steps = 0;
      for (let i = 0; i < fps * totalSeconds; i++) steps += stepper.advance(frameSeconds);
      return steps;
    };

    const expected = totalSeconds / DT_SECONDS; // 1000 ticks
    for (const fps of [30, 60, 90, 144, 240]) {
      // At most one step of rounding can remain in the accumulator.
      expect(Math.abs(stepsAt(fps) - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('survives wildly irregular frame times', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    const frames = [0.016, 0.004, 0.033, 0.002, 0.021, 0.05, 0.008, 0.016];

    let steps = 0;
    let elapsed = 0;
    for (let repeat = 0; repeat < 40; repeat++) {
      for (const frame of frames) {
        steps += stepper.advance(frame);
        elapsed += frame;
      }
    }

    expect(Math.abs(steps - elapsed / DT_SECONDS)).toBeLessThanOrEqual(1);
  });

  it('accumulates sub-step frames until they add up', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    // 1 ms frames: four produce nothing, the fifth completes a 5 ms step.
    expect(stepper.advance(0.001)).toBe(0);
    expect(stepper.advance(0.001)).toBe(0);
    expect(stepper.advance(0.001)).toBe(0);
    expect(stepper.advance(0.001)).toBe(0);
    expect(stepper.advance(0.001)).toBe(1);
  });

  it('runs several steps for one long frame', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    expect(stepper.advance(0.05)).toBe(10);
  });
});

describe('fixed timestep — spiral protection', () => {
  it('clamps an enormous frame gap', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    // A tab backgrounded for a minute must not queue 12,000 ticks.
    const steps = stepper.advance(60);
    expect(steps).toBe(MAX_FRAME / DT_SECONDS);
    expect(steps).toBe(50);
  });

  it('does not carry the discarded time forward', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    stepper.advance(60);
    expect(stepper.advance(1 / 60)).toBeLessThanOrEqual(4);
  });

  it('ignores negative and non-finite deltas', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    expect(stepper.advance(-1)).toBe(0);
    expect(stepper.advance(Number.NaN)).toBe(0);
    expect(stepper.advance(Number.POSITIVE_INFINITY)).toBe(MAX_FRAME / DT_SECONDS);
  });
});

describe('fixed timestep — interpolation factor', () => {
  it('stays within [0, 1)', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    for (let i = 0; i < 500; i++) {
      stepper.advance(((i % 7) + 1) / 1000);
      expect(stepper.alpha).toBeGreaterThanOrEqual(0);
      expect(stepper.alpha).toBeLessThan(1);
    }
  });

  it('reports the fraction of a step that is pending', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    stepper.advance(DT_SECONDS * 2.5);
    expect(stepper.alpha).toBeCloseTo(0.5, 9);
    expect(stepper.pending).toBeCloseTo(DT_SECONDS * 0.5, 12);
  });

  it('is zero after an exact multiple of dt', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    stepper.advance(DT_SECONDS * 3);
    expect(stepper.alpha).toBeCloseTo(0, 12);
  });

  it('reset() clears pending time', () => {
    const stepper = new FixedTimestepAccumulator(DT_SECONDS, MAX_FRAME);
    stepper.advance(DT_SECONDS * 1.5);
    stepper.reset();
    expect(stepper.pending).toBe(0);
    expect(stepper.alpha).toBe(0);
  });
});

describe('fixed timestep — construction', () => {
  it('rejects an invalid configuration', () => {
    expect(() => new FixedTimestepAccumulator(0, 1)).toThrow(/dt must be positive/);
    expect(() => new FixedTimestepAccumulator(0.005, 0.001)).toThrow(/at least one dt/);
  });
});
