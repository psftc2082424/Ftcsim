/**
 * Contact resolution: normal impulse plus positional correction.
 *
 * Two independent jobs, deliberately kept separate:
 *
 *   1. **Impulse** removes the approaching component of relative velocity at the
 *      contact point, so bodies stop moving into each other. Applying it at the
 *      contact point rather than at the centre of mass is what makes a robot
 *      that clips a wall corner rotate, which is the real behaviour.
 *
 *   2. **Positional correction** pushes out residual overlap that the impulse
 *      alone cannot remove, because velocity was already zero when the overlap
 *      was detected. Without it, penetration accumulates and bodies sink.
 *
 * **Contacts are frictionless.** Only the normal component is resolved. Adding
 * tangential friction would require a coefficient, and Phase 1 introduces no
 * friction coefficient of any kind (PRODUCT_SPEC.md §4). A robot sliding along a
 * wall therefore keeps its tangential speed. Recorded in ASSUMPTIONS.md §5.1.
 */

import { isStatic, type RigidBody } from './body.js';
import { vec2 } from '../math/vec2.js';
import type { Contact } from './sat.js';

/**
 * Fraction of remaining penetration corrected per tick. Below 1 so that
 * correction is damped rather than jittering bodies apart. Numerical, not
 * physical — ASSUMPTIONS.md §5.3.
 */
export const POSITIONAL_CORRECTION_RATE = 0.8;

/**
 * Penetration tolerated without correction, in metres (1 mm). A small allowance
 * stops resting contacts from oscillating between overlapping and separated.
 */
export const PENETRATION_SLOP_M = 0.001;

/**
 * Resolve one contact in place.
 *
 * `contact.normal` points from A toward B (see `sat.ts`), so B is pushed along
 * +normal and A along -normal.
 */
export function resolveContact(a: RigidBody, b: RigidBody, contact: Contact): void {
  const invMassSum = a.invMass + b.invMass;
  if (invMassSum === 0) return; // two static bodies: nothing to do

  const { normal, point } = contact;

  // Lever arms from each centre of mass to the contact point.
  const rax = point.x - a.pose.p.x;
  const ray = point.y - a.pose.p.y;
  const rbx = point.x - b.pose.p.x;
  const rby = point.y - b.pose.p.y;

  // Relative velocity of the material points in contact.
  const vax = a.vel.v.x - a.vel.omega * ray;
  const vay = a.vel.v.y + a.vel.omega * rax;
  const vbx = b.vel.v.x - b.vel.omega * rby;
  const vby = b.vel.v.y + b.vel.omega * rbx;

  const rvx = vbx - vax;
  const rvy = vby - vay;
  const approachSpeed = rvx * normal.x + rvy * normal.y;

  // Already separating: an impulse here would suck the bodies together.
  if (approachSpeed > 0) {
    applyPositionalCorrection(a, b, contact, invMassSum);
    return;
  }

  const raCrossN = rax * normal.y - ray * normal.x;
  const rbCrossN = rbx * normal.y - rby * normal.x;

  const effectiveMassInv =
    invMassSum + a.invInertiaZ * raCrossN * raCrossN + b.invInertiaZ * rbCrossN * rbCrossN;
  if (effectiveMassInv === 0) return;

  const restitution = Math.min(a.restitution, b.restitution);
  const j = (-(1 + restitution) * approachSpeed) / effectiveMassInv;

  const impulseX = normal.x * j;
  const impulseY = normal.y * j;

  if (!isStatic(a)) {
    a.vel = {
      v: vec2(a.vel.v.x - impulseX * a.invMass, a.vel.v.y - impulseY * a.invMass),
      omega: a.vel.omega - a.invInertiaZ * (rax * impulseY - ray * impulseX),
    };
  }
  if (!isStatic(b)) {
    b.vel = {
      v: vec2(b.vel.v.x + impulseX * b.invMass, b.vel.v.y + impulseY * b.invMass),
      omega: b.vel.omega + b.invInertiaZ * (rbx * impulseY - rby * impulseX),
    };
  }

  applyPositionalCorrection(a, b, contact, invMassSum);
}

function applyPositionalCorrection(
  a: RigidBody,
  b: RigidBody,
  contact: Contact,
  invMassSum: number,
): void {
  const overlap = contact.depth - PENETRATION_SLOP_M;
  if (overlap <= 0) return;

  const magnitude = (overlap / invMassSum) * POSITIONAL_CORRECTION_RATE;
  const cx = contact.normal.x * magnitude;
  const cy = contact.normal.y * magnitude;

  if (!isStatic(a)) {
    a.pose = {
      p: vec2(a.pose.p.x - cx * a.invMass, a.pose.p.y - cy * a.invMass),
      theta: a.pose.theta,
    };
  }
  if (!isStatic(b)) {
    b.pose = {
      p: vec2(b.pose.p.x + cx * b.invMass, b.pose.p.y + cy * b.invMass),
      theta: b.pose.theta,
    };
  }
}
