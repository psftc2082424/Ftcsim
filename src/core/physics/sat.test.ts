import { describe, expect, it } from 'vitest';
import { collide } from './sat.js';
import { createCircle, createObb, createPoly, createRectPoly } from './shapes.js';
import { vec2 } from '../math/vec2.js';
import type { Pose } from './body.js';

const at = (x: number, y: number, theta = 0): Pose => ({ p: vec2(x, y), theta });

describe('polygon vs polygon', () => {
  const box = createObb(2, 2); // 2 m x 2 m, half extents 1

  it('reports no contact when clearly separated', () => {
    expect(collide(box, at(0, 0), box, at(5, 0))).toBeNull();
    expect(collide(box, at(0, 0), box, at(0, -5))).toBeNull();
  });

  it('reports no contact when separated on a diagonal', () => {
    expect(collide(box, at(0, 0), box, at(2.5, 2.5))).toBeNull();
  });

  it('detects overlap and reports the shallow axis', () => {
    // Centres 1.5 apart on X: overlap of 0.5 on X, 2.0 on Y. The shallow axis
    // wins, so the normal must be along X.
    const contact = collide(box, at(0, 0), box, at(1.5, 0));
    expect(contact).not.toBeNull();
    expect(contact?.depth).toBeCloseTo(0.5, 9);
    expect(Math.abs(contact?.normal.x ?? 0)).toBeCloseTo(1, 9);
    expect(Math.abs(contact?.normal.y ?? 0)).toBeCloseTo(0, 9);
  });

  it('points the normal from A toward B', () => {
    const right = collide(box, at(0, 0), box, at(1.5, 0));
    expect(right?.normal.x).toBeGreaterThan(0);

    const left = collide(box, at(0, 0), box, at(-1.5, 0));
    expect(left?.normal.x).toBeLessThan(0);
  });

  it('is symmetric: swapping A and B flips the normal', () => {
    const ab = collide(box, at(0, 0), box, at(1.5, 0.3));
    const ba = collide(box, at(1.5, 0.3), box, at(0, 0));
    expect(ab).not.toBeNull();
    expect(ba).not.toBeNull();
    expect(ab?.depth).toBeCloseTo(ba?.depth ?? 0, 9);
    expect(ab?.normal.x).toBeCloseTo(-(ba?.normal.x ?? 0), 9);
    expect(ab?.normal.y).toBeCloseTo(-(ba?.normal.y ?? 0), 9);
  });

  it('accounts for rotation', () => {
    // A square rotated 45 degrees has a longer diagonal reach, so a gap that
    // clears the axis-aligned box is penetrated by the rotated one.
    const gap = at(2.2, 0);
    expect(collide(box, at(0, 0), box, gap)).toBeNull();
    expect(collide(box, at(0, 0), box, { p: gap.p, theta: Math.PI / 4 })).not.toBeNull();
  });

  it('builds a two-point manifold spanning a face-on overlap', () => {
    // Two squares meeting flat share a whole face, so the manifold has to hold
    // both ends of it. A single point anywhere on that face would give a robot
    // squaring up to a wall a spurious spin.
    const contact = collide(box, at(0, 0), box, at(1.5, 0));
    expect(contact?.points).toHaveLength(2);

    const ys = (contact?.points ?? []).map((p) => p.position.y).sort((l, r) => l - r);
    expect(ys[0]).toBeCloseTo(-1, 9);
    expect(ys[1]).toBeCloseTo(1, 9);

    // Both ends are equally deep, and the manifold is symmetric about the
    // shared axis, so the two impulses cancel in torque.
    for (const point of contact?.points ?? []) {
      expect(point.position.x).toBeCloseTo(0.5, 9);
      expect(point.depth).toBeCloseTo(0.5, 9);
    }
  });

  it('reduces a corner contact to a single point', () => {
    // A box rotated 45 degrees pokes one corner into its neighbour. Only that
    // corner is touching, and a one-point manifold is what lets the impulse
    // rotate the body — real behaviour that the face-on case must not have.
    const contact = collide(box, at(0, 0), box, { p: vec2(2.2, 0), theta: Math.PI / 4 });
    expect(contact?.points).toHaveLength(1);
    expect(contact?.points[0]?.position.y).toBeCloseTo(0, 9);
  });

  it('handles a non-square rectangle', () => {
    const long = createObb(4, 1); // 4 m along local X, 1 m along local Y
    expect(collide(long, at(0, 0), long, at(3.5, 0))).not.toBeNull();
    expect(collide(long, at(0, 0), long, at(4.5, 0))).toBeNull();
    expect(collide(long, at(0, 0), long, at(0, 1.5))).toBeNull();
  });
});

describe('circle vs circle', () => {
  const c1 = createCircle(1);

  it('detects and misses correctly', () => {
    expect(collide(c1, at(0, 0), c1, at(3, 0))).toBeNull();
    expect(collide(c1, at(0, 0), c1, at(1.5, 0))).not.toBeNull();
  });

  it('reports the correct depth and normal', () => {
    const contact = collide(c1, at(0, 0), c1, at(1.5, 0));
    expect(contact?.depth).toBeCloseTo(0.5, 12);
    expect(contact?.normal.x).toBeCloseTo(1, 12);
    expect(contact?.points).toHaveLength(1);
    expect(contact?.points[0]?.position.x).toBeCloseTo(1, 12);
  });

  it('produces a finite normal for concentric circles', () => {
    const contact = collide(c1, at(0, 0), c1, at(0, 0));
    expect(contact).not.toBeNull();
    expect(Number.isFinite(contact?.normal.x ?? NaN)).toBe(true);
    expect(Number.isFinite(contact?.normal.y ?? NaN)).toBe(true);
  });
});

describe('circle vs polygon', () => {
  const box = createObb(2, 2);
  const circle = createCircle(0.5);

  it('misses when outside', () => {
    expect(collide(circle, at(2, 0), box, at(0, 0))).toBeNull();
  });

  it('hits a face', () => {
    const contact = collide(circle, at(1.3, 0), box, at(0, 0));
    expect(contact).not.toBeNull();
    expect(contact?.depth).toBeCloseTo(0.2, 9);
    // Normal points from the circle toward the box, i.e. in -X.
    expect(contact?.normal.x).toBeCloseTo(-1, 9);
  });

  it('hits a corner', () => {
    const contact = collide(circle, at(1.3, 1.3), box, at(0, 0));
    expect(contact).not.toBeNull();
    expect(contact?.normal.x).toBeLessThan(0);
    expect(contact?.normal.y).toBeLessThan(0);
  });

  it('resolves a circle centre inside the polygon', () => {
    const contact = collide(circle, at(0, 0), box, at(0, 0));
    expect(contact).not.toBeNull();
    expect(contact?.depth).toBeGreaterThan(0.5);
  });

  it('flips the normal correctly when the polygon is argument A', () => {
    const circleFirst = collide(circle, at(1.3, 0), box, at(0, 0));
    const boxFirst = collide(box, at(0, 0), circle, at(1.3, 0));
    expect(boxFirst).not.toBeNull();
    expect(boxFirst?.normal.x).toBeCloseTo(-(circleFirst?.normal.x ?? 0), 9);
  });
});

describe('regression — normal orientation must not depend on body pose', () => {
  /**
   * Bug: `polyPoly` originally oriented the least-overlap axis by comparing the
   * two bodies' `pose.p`. A static body may legitimately carry world-space
   * vertices while its pose stays at the origin — which is exactly how the field
   * perimeter was built — and for those the pose comparison reverses the normal.
   * The resolver then pushed the robot *through* the wall instead of stopping
   * it, and a robot driven at the east wall ended up 7.7 m outside a 3.7 m
   * field.
   *
   * Direction is now read from the projections themselves, so a shape's pose is
   * irrelevant to the result.
   */
  it('orients A->B correctly when B has world-baked vertices at a zero pose', () => {
    const robot = createObb(0.457, 0.457);
    // A wall to the east, expressed in world coordinates with pose at origin.
    const wall = createRectPoly(1.8542, 0, 0.0508, 3.7592);

    const contact = collide(robot, at(1.7, 0), wall, at(0, 0));
    expect(contact).not.toBeNull();

    // The wall is east of the robot, so the normal must point east.
    expect(contact?.normal.x).toBeCloseTo(1, 9);
    // Robot spans to 1.7 + 0.2285 = 1.9285; the wall's near face is at 1.8288.
    expect(contact?.depth).toBeCloseTo(0.0997, 6);
    // Contact belongs on the wall's near face, not its far face — and it spans
    // only the width of the robot, not the width of the wall.
    for (const point of contact?.points ?? []) {
      expect(point.position.x).toBeCloseTo(1.8288, 6);
      expect(Math.abs(point.position.y)).toBeCloseTo(0.2285, 6);
    }
  });

  it('agrees with the equivalent pose-centred box', () => {
    const robot = createObb(0.457, 0.457);
    const asPolyAtOrigin = createRectPoly(1.8542, 0, 0.0508, 3.7592);
    const asBoxAtPose = createObb(0.0508, 3.7592);

    const a = collide(robot, at(1.7, 0), asPolyAtOrigin, at(0, 0));
    const b = collide(robot, at(1.7, 0), asBoxAtPose, at(1.8542, 0));

    expect(a?.normal.x).toBeCloseTo(b?.normal.x ?? 0, 9);
    expect(a?.depth).toBeCloseTo(b?.depth ?? 0, 9);
    expect(a?.points).toHaveLength(b?.points.length ?? 0);
    expect(a?.points[0]?.position.x).toBeCloseTo(b?.points[0]?.position.x ?? 0, 9);
  });
});

describe('polygon construction validation', () => {
  it('rejects a concave polygon', () => {
    // An arrowhead: the reflex vertex makes SAT silently wrong, so it is
    // rejected at construction instead.
    expect(() =>
      createPoly([vec2(0, 0), vec2(2, 0), vec2(1, 1), vec2(2, 2), vec2(0, 2)]),
    ).toThrow(/not convex/);
  });

  it('rejects clockwise winding', () => {
    expect(() => createPoly([vec2(0, 0), vec2(0, 1), vec2(1, 1), vec2(1, 0)])).toThrow(
      /counter-clockwise/,
    );
  });

  it('rejects a degenerate vertex count', () => {
    expect(() => createPoly([vec2(0, 0), vec2(1, 1)])).toThrow(/at least 3/);
  });

  it('accepts the axis-aligned rectangle helper', () => {
    const rect = createRectPoly(1, 2, 4, 6);
    expect(rect.vertices).toHaveLength(4);
    expect(collide(rect, at(0, 0), createCircle(0.1), at(1, 2))).not.toBeNull();
  });

  it('rejects non-positive extents', () => {
    expect(() => createObb(0, 1)).toThrow(/positive extents/);
    expect(() => createCircle(-1)).toThrow(/positive radius/);
  });
});
