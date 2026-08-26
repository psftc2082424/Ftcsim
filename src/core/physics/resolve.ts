/**
 * Contact resolution: normal impulses plus positional correction.
 *
 * Two independent jobs, deliberately kept separate:
 *
 *   1. **Impulses** remove the approaching component of relative velocity at
 *      each manifold point, so bodies stop moving into each other. Applying them
 *      at the contact points rather than at the centre of mass is what makes a
 *      robot that clips a wall corner rotate, which is the real behaviour — and,
 *      equally, what makes a robot that meets a wall flat *not* rotate, because a
 *      face-on manifold has two points whose torques cancel.
 *
 *   2. **Positional correction** pushes out residual overlap that impulses alone
 *      cannot remove, because velocity was already zero when the overlap was
 *      detected. Without it, penetration accumulates and bodies sink. It is
 *      applied as a pure translation along the normal: rotating a body to
 *      resolve penetration would reintroduce exactly the spurious spin the
 *      manifold exists to prevent.
 *
 * **Contacts are frictionless.** Only the normal component is resolved. Adding
 * tangential friction would require a coefficient, and Phase 1 introduces no
 * friction coefficient of any kind (PRODUCT_SPEC.md §4). A robot sliding along a
 * wall therefore keeps its tangential speed. Recorded in ASSUMPTIONS.md §5.1.
 */

import { isStatic, type RigidBody } from './body.js';
import { vec2 } from '../math/vec2.js';
import type { Contact, ContactPoint } from './sat.js';

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
 * Gauss-Seidel sweeps over the manifold's points.
 *
 * The two points of a face-on contact are coupled through the body's rotation,
 * so solving them once each leaves a residual spin — enough to visibly rotate a
 * robot that squares up against a wall. Sweeping repeatedly converges on the
 * solution where both points are simultaneously non-approaching; for a 3:1
 * box the error falls by about 25x per sweep, so eight is far past the point of
 * diminishing returns and still trivially cheap for the handful of contacts an
 * FTC field produces. ASSUMPTIONS.md §5.6.
 */
export const NORMAL_SOLVER_SWEEPS = 8;

/** A polygon manifold holds at most two points; a circle contact holds one. */
const MAX_MANIFOLD_POINTS = 2;

/**
 * Per-point solver state, allocated once at module load and reused.
 *
 * Contacts are resolved one pair at a time on a single thread, so a shared
 * scratch buffer keeps the hot loop allocation-free (CLAUDE.md, Performance).
 */
interface PointSolver {
  rax: number;
  ray: number;
  rbx: number;
  rby: number;
  /** Effective mass along the normal at this point. */
  normalMass: number;
  /** Target separating speed, from restitution and the *initial* approach. */
  velocityBias: number;
  /** Total normal impulse applied so far; never allowed to go negative. */
  accumulated: number;
}

const scratch: PointSolver[] = Array.from({ length: MAX_MANIFOLD_POINTS }, () => ({
  rax: 0,
  ray: 0,
  rbx: 0,
  rby: 0,
  normalMass: 0,
  velocityBias: 0,
  accumulated: 0,
}));

/**
 * Resolve one contact in place.
 *
 * `contact.normal` points from A toward B (see `sat.ts`), so B is pushed along
 * +normal and A along -normal.
 */
export function resolveContact(a: RigidBody, b: RigidBody, contact: Contact): void {
  const invMassSum = a.invMass + b.invMass;
  if (invMassSum === 0) return; // two static bodies: nothing to do

  const count = prepare(a, b, contact, invMassSum);
  if (count > 0) solveNormalImpulses(a, b, contact, count);

  applyPositionalCorrection(a, b, contact, invMassSum);
}

/** Fill the scratch buffer for this contact. Returns how many points are live. */
function prepare(a: RigidBody, b: RigidBody, contact: Contact, invMassSum: number): number {
  const { normal, points } = contact;
  const restitution = Math.min(a.restitution, b.restitution);

  let count = 0;
  for (let i = 0; i < points.length && count < MAX_MANIFOLD_POINTS; i++) {
    const position = (points[i] as ContactPoint).position;
    const solver = scratch[count] as PointSolver;

    solver.rax = position.x - a.pose.p.x;
    solver.ray = position.y - a.pose.p.y;
    solver.rbx = position.x - b.pose.p.x;
    solver.rby = position.y - b.pose.p.y;

    const raCrossN = solver.rax * normal.y - solver.ray * normal.x;
    const rbCrossN = solver.rbx * normal.y - solver.rby * normal.x;

    const inverseMass =
      invMassSum + a.invInertiaZ * raCrossN * raCrossN + b.invInertiaZ * rbCrossN * rbCrossN;
    if (inverseMass === 0) continue;

    solver.normalMass = 1 / inverseMass;

    // Restitution is measured against the approach speed at the *start* of the
    // solve. Reading it inside the sweep loop instead would let the bounce shrink
    // with every sweep, making the result depend on the iteration count.
    const approach = normalVelocity(a, b, contact, solver);
    solver.velocityBias = approach < 0 ? -restitution * approach : 0;
    solver.accumulated = 0;

    count++;
  }

  return count;
}

/** Relative velocity of the two material points, projected on the normal. */
function normalVelocity(a: RigidBody, b: RigidBody, contact: Contact, s: PointSolver): number {
  const vax = a.vel.v.x - a.vel.omega * s.ray;
  const vay = a.vel.v.y + a.vel.omega * s.rax;
  const vbx = b.vel.v.x - b.vel.omega * s.rby;
  const vby = b.vel.v.y + b.vel.omega * s.rbx;

  return (vbx - vax) * contact.normal.x + (vby - vay) * contact.normal.y;
}

function solveNormalImpulses(
  a: RigidBody,
  b: RigidBody,
  contact: Contact,
  count: number,
): void {
  const { normal } = contact;

  for (let sweep = 0; sweep < NORMAL_SOLVER_SWEEPS; sweep++) {
    for (let i = 0; i < count; i++) {
      const solver = scratch[i] as PointSolver;

      const separating = normalVelocity(a, b, contact, solver);
      const wanted = -(separating - solver.velocityBias) * solver.normalMass;

      // Accumulate and clamp rather than clamping each increment: a contact may
      // legitimately need a *negative* correction on a later sweep, as long as
      // the total impulse it has applied never becomes a pull.
      const total = Math.max(solver.accumulated + wanted, 0);
      const applied = total - solver.accumulated;
      solver.accumulated = total;
      if (applied === 0) continue;

      const impulseX = normal.x * applied;
      const impulseY = normal.y * applied;

      if (!isStatic(a)) {
        a.vel = {
          v: vec2(a.vel.v.x - impulseX * a.invMass, a.vel.v.y - impulseY * a.invMass),
          omega: a.vel.omega - a.invInertiaZ * (solver.rax * impulseY - solver.ray * impulseX),
        };
      }
      if (!isStatic(b)) {
        b.vel = {
          v: vec2(b.vel.v.x + impulseX * b.invMass, b.vel.v.y + impulseY * b.invMass),
          omega: b.vel.omega + b.invInertiaZ * (solver.rbx * impulseY - solver.rby * impulseX),
        };
      }
    }
  }
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
