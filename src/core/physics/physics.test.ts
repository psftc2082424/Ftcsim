import { describe, expect, it } from 'vitest';
import { SpatialHash } from './broadphase.js';
import { integrateBody, integrateFree } from './integrate.js';
import { resolveContact } from './resolve.js';
import { createDynamicBody, createStaticBody, isStatic, spansOverlap, velocityAtPoint } from './body.js';
import { createObb, createRectPoly, shapeAabb } from './shapes.js';
import { collide } from './sat.js';
import { vec2 } from '../math/vec2.js';

const FLOOR = { bottom: 0, top: 0.45 };

function makeRobot(id = 0, mass = 14.5, pose = { p: vec2(0, 0), theta: 0 }) {
  return createDynamicBody({
    id,
    kind: 'robot',
    shape: createObb(0.457, 0.457),
    mass,
    inertiaZ: 0.5,
    span: FLOOR,
    pose,
  });
}

describe('spatial hash — correctness', () => {
  it('finds an overlapping pair', () => {
    const hash = new SpatialHash(0.3048);
    hash.insert(0, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    hash.insert(1, { minX: 0.5, minY: 0.5, maxX: 1.5, maxY: 1.5 });
    expect(hash.queryPairs()).toEqual([[0, 1]]);
  });

  it('ignores distant bodies', () => {
    const hash = new SpatialHash(0.3048);
    hash.insert(0, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    hash.insert(1, { minX: 10, minY: 10, maxX: 11, maxY: 11 });
    expect(hash.queryPairs()).toEqual([]);
  });

  it('reports a pair once even when they share many cells', () => {
    // Two large overlapping boxes span dozens of cells; without dedup the pair
    // would be reported once per shared cell.
    const hash = new SpatialHash(0.1);
    hash.insert(0, { minX: 0, minY: 0, maxX: 2, maxY: 2 });
    hash.insert(1, { minX: 0.1, minY: 0.1, maxX: 2.1, maxY: 2.1 });
    expect(hash.queryPairs()).toEqual([[0, 1]]);
  });

  it('handles negative coordinates', () => {
    const hash = new SpatialHash(0.3048);
    hash.insert(0, { minX: -2, minY: -2, maxX: -1, maxY: -1 });
    hash.insert(1, { minX: -1.5, minY: -1.5, maxX: -0.5, maxY: -0.5 });
    expect(hash.queryPairs()).toEqual([[0, 1]]);
  });

  it('rejects a non-positive cell size', () => {
    expect(() => new SpatialHash(0)).toThrow(/Cell size/);
  });
});

describe('spatial hash — determinism', () => {
  /**
   * Pair order must not depend on bucket iteration order, or the golden hash
   * test will flap for reasons unrelated to physics.
   */
  it('returns pairs sorted by id regardless of insertion order', () => {
    const boxes: Array<[number, number]> = [
      [5, 0],
      [2, 0.1],
      [9, 0.2],
      [1, 0.3],
      [7, 0.4],
    ];

    const forward = new SpatialHash(1);
    for (const [id, x] of boxes) forward.insert(id, { minX: x, minY: 0, maxX: x + 1, maxY: 1 });

    const reverse = new SpatialHash(1);
    for (const [id, x] of [...boxes].reverse()) {
      reverse.insert(id, { minX: x, minY: 0, maxX: x + 1, maxY: 1 });
    }

    const a = forward.queryPairs();
    const b = reverse.queryPairs();
    expect(a).toEqual(b);

    for (let i = 1; i < a.length; i++) {
      const previous = a[i - 1] as readonly [number, number];
      const current = a[i] as readonly [number, number];
      const ordered =
        current[0] > previous[0] || (current[0] === previous[0] && current[1] > previous[1]);
      expect(ordered).toBe(true);
    }
  });

  it('clear() empties the structure', () => {
    const hash = new SpatialHash(1);
    hash.insert(0, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(hash.size).toBe(1);
    hash.clear();
    expect(hash.size).toBe(0);
    expect(hash.occupiedCells).toBe(0);
    expect(hash.queryPairs()).toEqual([]);
  });
});

describe('semi-implicit Euler integration', () => {
  it('accumulates velocity exactly as v = a t', () => {
    const body = makeRobot(0, 10);
    const dt = 1 / 200;
    const force = 100; // N forward -> a = 10 m/s^2

    for (let i = 0; i < 200; i++) integrateBody(body, { fx: force, fy: 0, mz: 0 }, dt);

    expect(body.vel.v.x).toBeCloseTo(10 * 1.0, 9);
  });

  /**
   * Semi-implicit Euler advances position with the *new* velocity, so after n
   * steps position is a·dt²·n(n+1)/2 rather than the continuous ½a t². The
   * excess is exactly ½·a·dt·t, and asserting it pins the integrator's identity
   * rather than merely its approximate behaviour.
   */
  it('has the position offset characteristic of the symplectic form', () => {
    const body = makeRobot(0, 10);
    const dt = 1 / 200;
    const a = 10;
    const steps = 200;

    for (let i = 0; i < steps; i++) integrateBody(body, { fx: 100, fy: 0, mz: 0 }, dt);

    const t = steps * dt;
    const continuous = 0.5 * a * t * t;
    const expected = continuous + 0.5 * a * dt * t;
    expect(body.pose.p.x).toBeCloseTo(expected, 9);
  });

  it('applies force in the body frame, not the world frame', () => {
    // A robot facing +Y that is pushed "forward" must move along +Y.
    const body = makeRobot(0, 10, { p: vec2(0, 0), theta: Math.PI / 2 });
    integrateBody(body, { fx: 100, fy: 0, mz: 0 }, 1 / 200);

    expect(body.vel.v.x).toBeCloseTo(0, 9);
    expect(body.vel.v.y).toBeGreaterThan(0);
  });

  it('integrates rotation and wraps the heading', () => {
    const body = makeRobot();
    for (let i = 0; i < 400; i++) integrateBody(body, { fx: 0, fy: 0, mz: 5 }, 1 / 200);

    expect(body.vel.omega).toBeGreaterThan(0);
    expect(body.pose.theta).toBeGreaterThan(-Math.PI);
    expect(body.pose.theta).toBeLessThanOrEqual(Math.PI);
  });

  it('leaves free motion unchanged', () => {
    const body = makeRobot();
    body.vel = { v: vec2(1, 0), omega: 0 };
    integrateFree(body, 1 / 200);
    expect(body.vel.v.x).toBeCloseTo(1, 12);
    expect(body.pose.p.x).toBeCloseTo(1 / 200, 12);
  });

  it('never integrates a static body', () => {
    const wall = createStaticBody({ id: 99, shape: createRectPoly(0, 0, 1, 1), span: FLOOR });
    integrateBody(wall, { fx: 1000, fy: 1000, mz: 1000 }, 1 / 200);
    expect(wall.pose.p.x).toBe(0);
    expect(wall.vel.v.x).toBe(0);
    expect(isStatic(wall)).toBe(true);
  });
});

describe('contact resolution', () => {
  it('stops a robot driving into a static wall', () => {
    // Robot half-extent is 0.2285 m, so at x = 1.05 it spans to 1.2785 and
    // overlaps a wall whose near face is at 1.15.
    const robot = makeRobot(0, 14.5, { p: vec2(1.05, 0), theta: 0 });
    robot.vel = { v: vec2(2, 0), omega: 0 };

    const wall = createStaticBody({
      id: 100,
      shape: createRectPoly(1.2, 0, 0.1, 4),
      span: FLOOR,
    });

    const contact = collide(robot.shape, robot.pose, wall.shape, wall.pose);
    expect(contact).not.toBeNull();
    if (contact === null) return;

    resolveContact(robot, wall, contact);
    expect(robot.vel.v.x).toBeLessThanOrEqual(1e-9);
    expect(wall.vel.v.x).toBe(0);
  });

  it('pushes overlapping bodies apart', () => {
    const robot = makeRobot(0, 14.5, { p: vec2(1.15, 0), theta: 0 });
    const wall = createStaticBody({ id: 100, shape: createRectPoly(1.2, 0, 0.1, 4), span: FLOOR });

    const before = collide(robot.shape, robot.pose, wall.shape, wall.pose);
    expect(before).not.toBeNull();
    if (before === null) return;

    for (let i = 0; i < 30; i++) {
      const contact = collide(robot.shape, robot.pose, wall.shape, wall.pose);
      if (contact === null) break;
      resolveContact(robot, wall, contact);
    }

    const after = collide(robot.shape, robot.pose, wall.shape, wall.pose);
    const residual = after?.depth ?? 0;
    expect(residual).toBeLessThanOrEqual(before.depth);
    expect(residual).toBeLessThan(0.002);
  });

  it('conserves momentum between two dynamic bodies', () => {
    const a = makeRobot(0, 10, { p: vec2(0, 0), theta: 0 });
    const b = makeRobot(1, 10, { p: vec2(0.4, 0), theta: 0 });
    a.vel = { v: vec2(2, 0), omega: 0 };
    b.vel = { v: vec2(0, 0), omega: 0 };

    const before = a.mass * a.vel.v.x + b.mass * b.vel.v.x;

    const contact = collide(a.shape, a.pose, b.shape, b.pose);
    expect(contact).not.toBeNull();
    if (contact === null) return;
    resolveContact(a, b, contact);

    const after = a.mass * a.vel.v.x + b.mass * b.vel.v.x;
    expect(after).toBeCloseTo(before, 9);
  });

  it('does not pull separating bodies back together', () => {
    const robot = makeRobot(0, 14.5, { p: vec2(1.15, 0), theta: 0 });
    robot.vel = { v: vec2(-2, 0), omega: 0 }; // already moving away
    const wall = createStaticBody({ id: 100, shape: createRectPoly(1.2, 0, 0.1, 4), span: FLOOR });

    const contact = collide(robot.shape, robot.pose, wall.shape, wall.pose);
    if (contact === null) return;
    resolveContact(robot, wall, contact);

    expect(robot.vel.v.x).toBeCloseTo(-2, 9);
  });

  it('does nothing for two static bodies', () => {
    // Both shapes carry world-space vertices, so both poses sit at the origin.
    const a = createStaticBody({ id: 1, shape: createRectPoly(0, 0, 1, 1), span: FLOOR });
    const b = createStaticBody({ id: 2, shape: createRectPoly(0.5, 0, 1, 1), span: FLOOR });

    const contact = collide(a.shape, a.pose, b.shape, b.pose);
    expect(contact).not.toBeNull();
    if (contact === null) return;

    expect(() => resolveContact(a, b, contact)).not.toThrow();
    expect(a.pose.p.x).toBe(0);
    expect(b.pose.p.x).toBe(0);
    expect(a.vel.v.x).toBe(0);
    expect(b.vel.v.x).toBe(0);
  });
});

describe('vertical spans', () => {
  it('overlaps only when height intervals intersect', () => {
    expect(spansOverlap({ bottom: 0, top: 0.45 }, { bottom: 0, top: 0.3 })).toBe(true);
    // A robot 0.3 m tall passes under an element whose underside is at 0.4 m.
    expect(spansOverlap({ bottom: 0, top: 0.3 }, { bottom: 0.4, top: 1.0 })).toBe(false);
    // Touching exactly is not overlapping.
    expect(spansOverlap({ bottom: 0, top: 0.4 }, { bottom: 0.4, top: 1.0 })).toBe(false);
  });
});

describe('body helpers', () => {
  it('computes velocity at an offset point including rotation', () => {
    const body = makeRobot();
    body.vel = { v: vec2(0, 0), omega: 1 };
    const v = velocityAtPoint(body, vec2(1, 0));
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
  });

  it('grows the AABB when a box rotates', () => {
    const shape = createObb(2, 1);
    const square = shapeAabb(shape, vec2(0, 0), 0);
    const rotated = shapeAabb(shape, vec2(0, 0), Math.PI / 4);
    expect(rotated.maxY - rotated.minY).toBeGreaterThan(square.maxY - square.minY);
  });

  it('rejects a dynamic body with impossible inertial properties', () => {
    expect(() =>
      createDynamicBody({
        id: 0,
        kind: 'robot',
        shape: createObb(1, 1),
        mass: 0,
        inertiaZ: 1,
        span: FLOOR,
      }),
    ).toThrow(/positive mass/);
  });
});
