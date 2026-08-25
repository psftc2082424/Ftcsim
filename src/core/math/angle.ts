/**
 * Angle normalisation helpers.
 *
 * Heading convention for the whole simulator, fixed here so that every
 * transform can be read against one definition:
 *
 *   - The world frame is right-handed: +X to the right, +Y up the screen.
 *   - Heading 0 points along +X.
 *   - Positive rotation is counter-clockwise.
 *   - Robot body frame: +X is robot-forward, +Y is robot-left.
 *
 * Angles are radians everywhere in `core/`. Degrees exist only at the UI
 * boundary, via `units/convert.ts`.
 */

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

/** Normalise to (−π, π]. */
export function wrapPi(angle: number): number {
  let a = (angle + Math.PI) % TAU;
  if (a <= 0) a += TAU;
  return a - Math.PI;
}

/** Normalise to [0, 2π). */
export function wrapTau(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

/**
 * Smallest signed rotation carrying `from` onto `to`, in (−π, π].
 * Use this rather than `to - from` anywhere a heading error is computed.
 */
export function shortestDelta(from: number, to: number): number {
  return wrapPi(to - from);
}

/** Interpolate between two headings along the shorter arc. */
export function lerpAngle(from: number, to: number, t: number): number {
  return wrapPi(from + shortestDelta(from, to) * t);
}

/** True when two headings are within `epsilon`, accounting for wraparound. */
export function angleEquals(a: number, b: number, epsilon = 0): boolean {
  return Math.abs(shortestDelta(a, b)) <= epsilon;
}
