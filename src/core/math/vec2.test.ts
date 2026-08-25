import { describe, expect, it } from 'vitest';
import {
  UNIT_X,
  UNIT_Y,
  ZERO,
  add,
  addScaled,
  clampLength,
  cross,
  crossScalarVec,
  crossVecScalar,
  distance,
  dot,
  equals,
  isFiniteVec,
  length,
  lengthSq,
  lerp,
  neg,
  normalize,
  perp,
  rotate,
  scale,
  sub,
  vec2,
} from './vec2.js';

describe('construction and algebra', () => {
  it('adds, subtracts, scales and negates componentwise', () => {
    const a = vec2(3, 4);
    const b = vec2(-1, 2);

    expect(add(a, b)).toEqual({ x: 2, y: 6 });
    expect(sub(a, b)).toEqual({ x: 4, y: 2 });
    expect(scale(a, 2)).toEqual({ x: 6, y: 8 });
    expect(neg(a)).toEqual({ x: -3, y: -4 });
    expect(addScaled(a, b, 3)).toEqual({ x: 0, y: 10 });
  });

  it('leaves operands unmodified', () => {
    const a = vec2(1, 2);
    const b = vec2(3, 4);
    add(a, b);
    expect(a).toEqual({ x: 1, y: 2 });
    expect(b).toEqual({ x: 3, y: 4 });
  });
});

describe('products', () => {
  it('computes the dot product', () => {
    expect(dot(vec2(3, 4), vec2(2, 1))).toBe(10);
    expect(dot(UNIT_X, UNIT_Y)).toBe(0);
  });

  it('computes the scalar cross product', () => {
    expect(cross(UNIT_X, UNIT_Y)).toBe(1);
    expect(cross(UNIT_Y, UNIT_X)).toBe(-1);
    expect(cross(vec2(2, 3), vec2(2, 3))).toBe(0);
  });

  it('keeps the two mixed cross products antisymmetric', () => {
    const v = vec2(1.5, -2.5);
    const s = 3;
    expect(crossVecScalar(v, s)).toEqual(neg(crossScalarVec(s, v)));
  });
});

describe('magnitude', () => {
  it('computes length from a 3-4-5 triangle', () => {
    expect(length(vec2(3, 4))).toBe(5);
    expect(lengthSq(vec2(3, 4))).toBe(25);
    expect(distance(vec2(1, 1), vec2(4, 5))).toBe(5);
  });

  it('normalizes to unit length', () => {
    const n = normalize(vec2(3, 4));
    expect(length(n)).toBeCloseTo(1, 15);
    expect(n).toEqual({ x: 0.6, y: 0.8 });
  });

  it('returns ZERO rather than NaN for a zero-length input', () => {
    // A NaN escaping into body state would silently poison the simulation.
    const n = normalize(ZERO);
    expect(n).toEqual({ x: 0, y: 0 });
    expect(isFiniteVec(n)).toBe(true);
  });
});

describe('rotation', () => {
  it('rotates +X onto +Y at 90 degrees', () => {
    const r = rotate(UNIT_X, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 15);
    expect(r.y).toBeCloseTo(1, 15);
  });

  it('preserves length', () => {
    const v = vec2(2.5, -1.25);
    for (const theta of [0, 0.3, 1.2, Math.PI, -2.7]) {
      expect(length(rotate(v, theta))).toBeCloseTo(length(v), 12);
    }
  });

  it('returns to the original after a full turn', () => {
    const v = vec2(1.7, 0.3);
    expect(equals(rotate(v, Math.PI * 2), v, 1e-12)).toBe(true);
  });

  it('agrees with perp() at 90 degrees counter-clockwise', () => {
    const v = vec2(2, -3);
    expect(equals(rotate(v, Math.PI / 2), perp(v), 1e-12)).toBe(true);
  });
});

describe('interpolation and clamping', () => {
  it('lerps endpoints exactly', () => {
    const a = vec2(0, 0);
    const b = vec2(10, -4);
    expect(lerp(a, b, 0)).toEqual(a);
    expect(lerp(a, b, 1)).toEqual(b);
    expect(lerp(a, b, 0.5)).toEqual({ x: 5, y: -2 });
  });

  it('clampLength preserves direction while bounding magnitude', () => {
    const v = vec2(3, 4); // length 5
    const clamped = clampLength(v, 2.5);

    expect(length(clamped)).toBeCloseTo(2.5, 12);
    // Direction unchanged: cross product with the original stays zero.
    expect(Math.abs(cross(v, clamped))).toBeLessThan(1e-12);
  });

  it('clampLength leaves a short vector untouched', () => {
    const v = vec2(1, 0);
    expect(clampLength(v, 5)).toBe(v);
    expect(clampLength(ZERO, 5)).toBe(ZERO);
  });
});
