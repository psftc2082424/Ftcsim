/**
 * Rigid bodies.
 *
 * Two kinds exist in Phase 1: a dynamic robot and static field geometry. A
 * static body is expressed as infinite mass (`invMass = 0`), so the same impulse
 * maths handles both without a special case — the standard trick, and it keeps
 * the resolver honest rather than branching on `kind`.
 *
 * Every body carries a **vertical span**. Two bodies interact only if their
 * height intervals overlap. In Phase 1 everything sits on the floor and this is
 * always true, but modelling it now is what will later let a low robot drive
 * under a raised field element and make a clearance metric fall out of the
 * actual robot height rather than a lookup table (PRODUCT_SPEC.md §4, §13).
 */

import { ZERO, type Vec2 } from '../math/vec2.js';
import { shapeAabb, type Aabb, type Shape } from './shapes.js';

export type EntityId = number;

export type BodyKind = 'robot' | 'piece' | 'static';

/** Vertical extent above the floor, in metres. */
export interface VerticalSpan {
  readonly bottom: number;
  readonly top: number;
}

export interface Pose {
  readonly p: Vec2;
  /** Heading, radians, counter-clockwise from +X. */
  readonly theta: number;
}

export interface Velocity {
  /** World-frame linear velocity, m/s. */
  readonly v: Vec2;
  /** Angular velocity, rad/s, counter-clockwise. */
  readonly omega: number;
}

export interface RigidBody {
  readonly id: EntityId;
  readonly kind: BodyKind;
  pose: Pose;
  vel: Velocity;

  readonly mass: number;
  readonly invMass: number;
  readonly inertiaZ: number;
  readonly invInertiaZ: number;

  readonly shape: Shape;
  /**
   * Mutable, because a body can change height.
   *
   * Robots never do, but a launched game piece does, and its span has to rise
   * with it or a ball in flight would still collide with everything it passes
   * over a raised game-defined destination.
   */
  span: VerticalSpan;

  /** Restitution, 0 = fully inelastic. See ASSUMPTIONS.md §5.1. */
  readonly restitution: number;
}

export function createDynamicBody(params: {
  id: EntityId;
  kind: Exclude<BodyKind, 'static'>;
  shape: Shape;
  mass: number;
  inertiaZ: number;
  span: VerticalSpan;
  pose?: Pose;
  vel?: Velocity;
  restitution?: number;
}): RigidBody {
  if (!(params.mass > 0)) throw new Error(`Dynamic body needs positive mass, got ${params.mass}.`);
  if (!(params.inertiaZ > 0)) {
    throw new Error(`Dynamic body needs positive inertia, got ${params.inertiaZ}.`);
  }

  return {
    id: params.id,
    kind: params.kind,
    pose: params.pose ?? { p: ZERO, theta: 0 },
    vel: params.vel ?? { v: ZERO, omega: 0 },
    mass: params.mass,
    invMass: 1 / params.mass,
    inertiaZ: params.inertiaZ,
    invInertiaZ: 1 / params.inertiaZ,
    shape: params.shape,
    span: params.span,
    restitution: params.restitution ?? 0,
  };
}

/** Static geometry: infinite mass and inertia, never integrated. */
export function createStaticBody(params: {
  id: EntityId;
  shape: Shape;
  span: VerticalSpan;
  pose?: Pose;
  restitution?: number;
}): RigidBody {
  return {
    id: params.id,
    kind: 'static',
    pose: params.pose ?? { p: ZERO, theta: 0 },
    vel: { v: ZERO, omega: 0 },
    mass: Number.POSITIVE_INFINITY,
    invMass: 0,
    inertiaZ: Number.POSITIVE_INFINITY,
    invInertiaZ: 0,
    shape: params.shape,
    span: params.span,
    restitution: params.restitution ?? 0,
  };
}

export function bodyAabb(body: RigidBody): Aabb {
  return shapeAabb(body.shape, body.pose.p, body.pose.theta);
}

export function isStatic(body: RigidBody): boolean {
  return body.invMass === 0;
}

/** Height intervals overlap, so the two bodies occupy the same layer of space. */
export function spansOverlap(a: VerticalSpan, b: VerticalSpan): boolean {
  return a.bottom < b.top && b.bottom < a.top;
}

/** World-space velocity of the material point at `worldPoint`. */
export function velocityAtPoint(body: RigidBody, worldPoint: Vec2): Vec2 {
  const rx = worldPoint.x - body.pose.p.x;
  const ry = worldPoint.y - body.pose.p.y;
  return {
    x: body.vel.v.x - body.vel.omega * ry,
    y: body.vel.v.y + body.vel.omega * rx,
  };
}

export function isBodyFinite(body: RigidBody): boolean {
  return (
    Number.isFinite(body.pose.p.x) &&
    Number.isFinite(body.pose.p.y) &&
    Number.isFinite(body.pose.theta) &&
    Number.isFinite(body.vel.v.x) &&
    Number.isFinite(body.vel.v.y) &&
    Number.isFinite(body.vel.omega)
  );
}
