import { describe, expect, it } from 'vitest';
import { HALF_PI, TAU, angleEquals, lerpAngle, shortestDelta, wrapPi, wrapTau } from './angle.js';

describe('wrapPi', () => {
  it('leaves angles already in range untouched', () => {
    for (const a of [0, 0.5, -0.5, 3, -3]) {
      expect(wrapPi(a)).toBeCloseTo(a, 12);
    }
  });

  it('maps out-of-range angles into (-pi, pi]', () => {
    expect(wrapPi(TAU)).toBeCloseTo(0, 12);
    expect(wrapPi(-TAU)).toBeCloseTo(0, 12);
    expect(wrapPi(Math.PI * 3)).toBeCloseTo(Math.PI, 12);
    expect(wrapPi(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
  });

  it('always returns a value inside (-pi, pi]', () => {
    for (let i = -50; i <= 50; i++) {
      const wrapped = wrapPi(i * 0.7);
      expect(wrapped).toBeGreaterThan(-Math.PI - 1e-12);
      expect(wrapped).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });

  it('is idempotent', () => {
    for (let i = -20; i <= 20; i++) {
      const once = wrapPi(i * 1.3);
      expect(wrapPi(once)).toBeCloseTo(once, 12);
    }
  });

  it('differs from the input by a whole number of turns', () => {
    for (let i = -20; i <= 20; i++) {
      const a = i * 1.9;
      const turns = (a - wrapPi(a)) / TAU;
      expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-12);
    }
  });
});

describe('wrapTau', () => {
  it('maps into [0, 2pi)', () => {
    expect(wrapTau(0)).toBe(0);
    expect(wrapTau(TAU)).toBeCloseTo(0, 12);
    expect(wrapTau(-0.1)).toBeCloseTo(TAU - 0.1, 12);
    expect(wrapTau(TAU + 1)).toBeCloseTo(1, 12);
  });

  it('always returns a value inside [0, 2pi)', () => {
    for (let i = -50; i <= 50; i++) {
      const wrapped = wrapTau(i * 0.7);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(TAU);
    }
  });
});

describe('shortestDelta', () => {
  it('takes the short way around the wrap point', () => {
    // From just under +pi to just over -pi is a small positive step, not a
    // near-full turn backwards.
    const from = Math.PI - 0.05;
    const to = -Math.PI + 0.05;
    expect(shortestDelta(from, to)).toBeCloseTo(0.1, 12);
  });

  it('is antisymmetric away from the +pi boundary', () => {
    for (const [a, b] of [
      [0, 1],
      [0.5, -0.5],
      [2, 3],
    ] as const) {
      expect(shortestDelta(a, b)).toBeCloseTo(-shortestDelta(b, a), 12);
    }
  });

  it('never exceeds pi in magnitude', () => {
    for (let i = 0; i < 100; i++) {
      const from = (i - 50) * 0.37;
      const to = (i - 50) * -0.91;
      expect(Math.abs(shortestDelta(from, to))).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });

  it('carries from onto to', () => {
    const from = 2.9;
    const to = -2.9;
    expect(angleEquals(from + shortestDelta(from, to), to, 1e-12)).toBe(true);
  });
});

describe('lerpAngle', () => {
  it('hits both endpoints', () => {
    expect(angleEquals(lerpAngle(0.3, 1.2, 0), 0.3, 1e-12)).toBe(true);
    expect(angleEquals(lerpAngle(0.3, 1.2, 1), 1.2, 1e-12)).toBe(true);
  });

  it('interpolates across the wrap point along the short arc', () => {
    const mid = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    // Halfway is at +/-pi, not at 0.
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
  });
});

describe('angleEquals', () => {
  it('treats angles a full turn apart as equal', () => {
    expect(angleEquals(0.4, 0.4 + TAU, 1e-12)).toBe(true);
    expect(angleEquals(-Math.PI, Math.PI, 1e-12)).toBe(true);
  });

  it('rejects genuinely different angles', () => {
    expect(angleEquals(0, HALF_PI, 1e-6)).toBe(false);
  });
});
