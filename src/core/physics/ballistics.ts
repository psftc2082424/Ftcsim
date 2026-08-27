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
 * ── Why this exists again ───────────────────────────────────────────────────
 *
 * This module was removed when the shooter *mechanism* was simplified to a
 * functional state machine (no flywheel, no RPM, no motor-derived exit speed).
 * It has nothing to do with any of that: it is "how a piece falls," a fact
 * about game pieces, not about the mechanism that launched one. A ball leaving
 * the shooter needs to physically arc into a goal shaped like the real one —
 * open at the top, walled below the lip — and there is no way to do that
 * without a piece having a height. PRODUCT_SPEC.md §1.1 keeps the mechanism
 * itself deterministic and simple; it never asked for the piece to teleport.
 *
 * ── Why height was already here once ────────────────────────────────────────
 *
 * Bodies carry a `VerticalSpan`, and a pair only collides when their spans
 * overlap. That was written for a robot driving under a raised element; it is
 * what lets a ball in flight pass over a wall rather than through it, with no
 * new collision code.
 */

import { STANDARD_GRAVITY } from '../units/convert.js';

/**
 * Air resistance is not modelled.
 *
 * A 5 in polypropylene ball at 30 ft/s has a Reynolds number around 1.5e5 and a
 * drag coefficient near 0.5, which costs a few percent of range over a shot the
 * length of an FTC field. Including it would mean choosing a drag coefficient
 * and a spin model, and neither is published for this piece — the same reason
 * no rolling resistance exists. Consequence: launched pieces travel slightly
 * further and flatter than real ones, and the error grows with range.
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
 * Semi-implicit Euler, matching the planar integrator so the two halves of a
 * piece's motion advance the same way.
 *
 * `restitution` is the fraction of vertical speed kept on bouncing. Zero — the
 * value every body in this simulator carries — means a piece lands and stays
 * down, rolling on under its horizontal velocity.
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
 * The textbook range, `v^2 sin(2θ) / g`. Kept as the closed form tests measure
 * an integrated trajectory against.
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

/**
 * A shot aimed to be exactly at its apex above a target point.
 *
 * This is the "idealized, adaptive-aiming" solution a functional shooter uses
 * instead of a fixed exit speed and angle: given how far away the target is and
 * how high the ball needs to be *when it gets there* (e.g. clear of a goal's
 * lip, with a margin), solve for the horizontal and vertical speed that put the
 * ball at that height, at the apex of its arc, exactly above the target.
 *
 * Apex is the right point to target rather than "passing through at height H
 * somewhere along the way": it is the one point on a parabola whose height does
 * not depend on exactly where the target sits along the approach, which is what
 * makes a single closed-form solution correct for every distance without a
 * search. Time to apex comes from the vertical-only equation
 * `0 = v_y - g t`, giving `t = sqrt(2 H_rise / g)`; the horizontal speed is
 * whatever covers the horizontal distance in that same time.
 *
 * Deterministic and perfectly accurate by construction — there is no aiming
 * error to solve for, only geometry — which is what "functional, not modelled
 * in flywheel detail" asks for (PRODUCT_SPEC.md §1.1).
 */
export function apexShot(
  horizontalDistanceM: number,
  launchHeightM: number,
  apexHeightM: number,
): { readonly horizontalMps: number; readonly verticalMps: number } {
  const riseM = Math.max(0, apexHeightM - launchHeightM);
  if (riseM === 0 || horizontalDistanceM === 0) {
    return { horizontalMps: horizontalDistanceM / DT_FLOOR, verticalMps: 0 };
  }
  const timeToApexSec = Math.sqrt((2 * riseM) / STANDARD_GRAVITY);
  return {
    horizontalMps: horizontalDistanceM / timeToApexSec,
    verticalMps: Math.sqrt(2 * STANDARD_GRAVITY * riseM),
  };
}

/**
 * Floor used only to avoid dividing by zero for a target at the launch point.
 * Never observed in practice — nothing fires at itself — and any positive
 * value works since the numerator is also zero.
 */
const DT_FLOOR = 1 / 200;
