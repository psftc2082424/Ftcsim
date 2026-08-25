/**
 * Immutable 2D vector.
 *
 * Components are plain numbers. Their unit is fixed by the field that holds the
 * vector (a body's `pose.p` is metres, its `vel.v` is m/s) rather than by a type
 * brand: branding both components would force a cast on every arithmetic result
 * and make the physics harder to read than the unit safety is worth. Unit
 * correctness at module boundaries is carried by the scalar brands in
 * `units/si.ts`.
 *
 * All operations are pure and allocate a new vector. The simulation runs at
 * 200 Hz with a handful of bodies, so allocation is not a bottleneck; if
 * profiling ever says otherwise, in-place variants can be added alongside.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });
export const UNIT_X: Vec2 = Object.freeze({ x: 1, y: 0 });
export const UNIT_Y: Vec2 = Object.freeze({ x: 0, y: 1 });

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function neg(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

/** Componentwise multiply-add: `a + b * s`. */
export function addScaled(a: Vec2, b: Vec2, s: number): Vec2 {
  return { x: a.x + b.x * s, y: a.y + b.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Scalar (z-component) cross product of two planar vectors. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Cross product of a planar vector with an out-of-plane scalar: `v × s`. */
export function crossVecScalar(v: Vec2, s: number): Vec2 {
  return { x: v.y * s, y: -v.x * s };
}

/** Cross product of an out-of-plane scalar with a planar vector: `s × v`. */
export function crossScalarVec(s: number, v: Vec2): Vec2 {
  return { x: -s * v.y, y: s * v.x };
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Unit vector in the direction of `v`. Returns `ZERO` for a zero-length input
 * rather than producing NaN — a NaN leaking into body state would silently
 * poison the whole simulation.
 */
export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return ZERO;
  return { x: v.x / len, y: v.y / len };
}

/** Rotate counter-clockwise by `theta` radians. */
export function rotate(v: Vec2, theta: number): Vec2 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Perpendicular vector, 90° counter-clockwise. */
export function perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function equals(a: Vec2, b: Vec2, epsilon = 0): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

export function isFiniteVec(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

/**
 * Clamp a vector's magnitude to `maxLength`, preserving direction.
 * Used where a magnitude bound must not rotate the commanded direction.
 */
export function clampLength(v: Vec2, maxLength: number): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len <= maxLength || len === 0) return v;
  const s = maxLength / len;
  return { x: v.x * s, y: v.y * s };
}
