/**
 * Semi-implicit (symplectic) Euler integration.
 *
 *     v <- v + (F/m) dt          then     p <- p + v dt
 *
 * Velocity is updated *before* position, using the new velocity to advance
 * position. That ordering is what makes the scheme symplectic and keeps it
 * stable over long runs, unlike explicit Euler which injects energy.
 *
 * A higher-order integrator would buy nothing here: at 200 Hz the dominant
 * dynamics are first-order (the motor torque-speed relation), and the error term
 * is far below the uncertainty in the physical assumptions themselves
 * (ASSUMPTIONS.md §4.2).
 */

import { wrapPi } from '../math/angle.js';
import { rotate, vec2, type Vec2 } from '../math/vec2.js';
import { isStatic, type RigidBody } from './body.js';

/** Body-frame force and torque to apply for one tick. */
export interface BodyWrench {
  /** Forward force in the body frame, N. */
  readonly fx: number;
  /** Leftward force in the body frame, N. */
  readonly fy: number;
  /** Counter-clockwise torque, N·m. */
  readonly mz: number;
}

/**
 * Advance one body by `dt` under a body-frame wrench.
 *
 * The wrench arrives in the body frame because that is how the drivetrain
 * naturally produces it; it is rotated into the world frame here, once, using
 * the heading at the start of the tick.
 */
export function integrateBody(body: RigidBody, wrench: BodyWrench, dt: number): void {
  if (isStatic(body)) return;

  const worldForce = rotate(vec2(wrench.fx, wrench.fy), body.pose.theta);

  const ax = worldForce.x * body.invMass;
  const ay = worldForce.y * body.invMass;
  const alpha = wrench.mz * body.invInertiaZ;

  const vx = body.vel.v.x + ax * dt;
  const vy = body.vel.v.y + ay * dt;
  const omega = body.vel.omega + alpha * dt;

  body.vel = { v: vec2(vx, vy), omega };
  body.pose = {
    p: vec2(body.pose.p.x + vx * dt, body.pose.p.y + vy * dt),
    theta: wrapPi(body.pose.theta + omega * dt),
  };
}

/** Advance a body with no applied wrench (free motion). */
export function integrateFree(body: RigidBody, dt: number): void {
  integrateBody(body, { fx: 0, fy: 0, mz: 0 }, dt);
}

/** World-frame linear acceleration implied by a body-frame wrench. */
export function accelerationOf(body: RigidBody, wrench: BodyWrench): Vec2 {
  const worldForce = rotate(vec2(wrench.fx, wrench.fy), body.pose.theta);
  return vec2(worldForce.x * body.invMass, worldForce.y * body.invMass);
}
