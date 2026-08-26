/**
 * Vertical motion for game pieces.
 *
 * The simulator is planar: bodies, contacts and the drivetrain all live in
 * (x, y), and that is the right model for robots, which never leave the floor.
 * A launched game piece does. So a piece carries one extra degree of freedom —
 * its height and the rate that is changing — integrated here while its
 * horizontal motion stays with the ordinary 2D body.
 *
 * That makes the model **2.5D**, and the split is exact rather than a
 * compromise: with no air resistance the horizontal and vertical components of
 * projectile motion are independent, so integrating them separately loses
 * nothing. What it does not model is anything that couples them — drag, spin,
 * Magnus lift — which is recorded below.
 *
 * ── Why height was already here ────────────────────────────────────────────
 *
 * Bodies have carried a `VerticalSpan` since Phase 1, and a pair only collides
 * when their spans overlap. That was written for a robot driving under a raised
 * element; it is what makes a ball in flight pass over a robot rather than
 * through it, with no new collision code.
 */

import { STANDARD_GRAVITY } from '../units/convert.js';

/**
 * Air resistance is not modelled.
 *
 * A 5 in polypropylene ball at 30 ft/s has a Reynolds number around 1.5e5 and a
 * drag coefficient near 0.5, which costs a few percent of range over a shot the
 * length of an FTC field. Including it would mean choosing a drag coefficient
 * and a spin model, and neither is published for this piece — the same reason
 * no rolling resistance exists (ASSUMPTIONS.md §2.4). Recorded in §5.9.
 *
 * Consequence: launched pieces travel slightly further and flatter than real
 * ones, and the error grows with range.
 */
export const BALLISTIC_DRAG_MODELLED = false;

/** Vertical state of a piece: how high its centre is, and how fast that changes. */
export interface VerticalState {
  /** Centre height above the floor, metres. */
  heightM: number;
  /** Rate of change of height, metres per second. Up is positive. */
  velocityMps: number;
}

export interface VerticalStepResult {
  readonly state: VerticalState;
  /** True on the tick the piece reached the floor from above. */
  readonly landed: boolean;
}

/**
 * Advance a piece's height by one tick under gravity.
 *
 * Semi-implicit Euler, matching the planar integrator (ARCHITECTURE.md §5.6) so
 * the two halves of a piece's motion advance the same way.
 *
 * `restitution` is the fraction of vertical speed kept on bouncing. Zero — the
 * value every body in this simulator carries (ASSUMPTIONS.md §5.1) — means a
 * piece lands and stays down, rolling on under its horizontal velocity.
 */
export function stepVertical(
  state: VerticalState,
  radiusM: number,
  dtSec: number,
  restitution = 0,
): VerticalStepResult {
  const velocityMps = state.velocityMps - STANDARD_GRAVITY * dtSec;
  const heightM = state.heightM + velocityMps * dtSec;

  // Resting height is one radius up: a ball on the floor touches it.
  if (heightM > radiusM) {
    return { state: { heightM, velocityMps }, landed: false };
  }

  const wasAirborne = state.heightM > radiusM + 1e-12 || state.velocityMps < 0;
  const bounced = -velocityMps * restitution;

  return {
    state: {
      heightM: radiusM,
      // Below the bounce threshold the piece is resting, not bouncing forever.
      velocityMps: bounced > MIN_BOUNCE_SPEED_MPS ? bounced : 0,
    },
    landed: wasAirborne,
  };
}

/**
 * Vertical speed below which a bounce is treated as a landing, m/s.
 *
 * With restitution zero this never applies. It exists so that a game which does
 * give its pieces a bounce terminates: each bounce is shorter than the last, and
 * without a floor the sequence converges in height but never in *count*, so the
 * piece would jitter against the floor forever. 1 cm/s is far below anything a
 * rule can observe.
 */
const MIN_BOUNCE_SPEED_MPS = 0.01;

/** Is a piece off the floor? */
export function isAirborne(state: VerticalState, radiusM: number): boolean {
  return state.heightM > radiusM + 1e-9 || state.velocityMps > 0;
}

/**
 * Split a launch into the horizontal speed and vertical rate it produces.
 *
 * `elevationRad` is measured up from the floor, so a zero-elevation launch is a
 * pure horizontal throw and 90 degrees is straight up.
 */
export function launchComponents(
  speedMps: number,
  elevationRad: number,
): { readonly horizontalMps: number; readonly verticalMps: number } {
  return {
    horizontalMps: speedMps * Math.cos(elevationRad),
    verticalMps: speedMps * Math.sin(elevationRad),
  };
}

/**
 * How far a launch carries before returning to the height it left from.
 *
 * The textbook range, `v^2 sin(2θ) / g`. Not used by the simulation — the
 * trajectory is integrated — but it is the closed form the tests measure the
 * integration against, the same way `analyticFreeSpeed` backs the drivetrain.
 */
export function analyticRange(speedMps: number, elevationRad: number): number {
  return (speedMps * speedMps * Math.sin(2 * elevationRad)) / STANDARD_GRAVITY;
}

/**
 * Peak height above the launch point, `v^2 sin^2(θ) / 2g`.
 *
 * The number that decides whether a shot clears a goal lip, so it is worth
 * having in closed form to test against.
 */
export function analyticApex(speedMps: number, elevationRad: number): number {
  const vertical = speedMps * Math.sin(elevationRad);
  return (vertical * vertical) / (2 * STANDARD_GRAVITY);
}
