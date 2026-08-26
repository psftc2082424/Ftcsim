/**
 * Collision shapes.
 *
 * Two primitives cover everything the simulator needs: a convex polygon (which
 * an oriented box is a special case of) and a circle. Field perimeter and field
 * elements are static convex polygons; the robot is an oriented box; game pieces
 * will be circles.
 *
 * An oriented box is stored by its half-extents rather than expanded into a
 * polygon at construction, because the renderer and the robot model both want
 * the extents directly. Its four corners are generated on demand, so SAT sees a
 * single polygon code path.
 *
 * Local frame convention matches the robot body frame (`math/angle.ts`):
 * +X forward along the robot's length, +Y to the robot's left across its width.
 */

import { rotate, vec2, type Vec2 } from '../math/vec2.js';

export interface Obb {
  readonly kind: 'obb';
  /** x = half length (forward), y = half width (left). */
  readonly halfExtents: Vec2;
}

export interface Circle {
  readonly kind: 'circle';
  readonly radius: number;
}

export interface ConvexPoly {
  readonly kind: 'poly';
  /** Local-frame vertices, counter-clockwise, convex. */
  readonly vertices: readonly Vec2[];
}

export type Shape = Obb | Circle | ConvexPoly;

export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function createObb(lengthM: number, widthM: number): Obb {
  if (!(lengthM > 0) || !(widthM > 0)) {
    throw new Error(`OBB needs positive extents, got ${lengthM} x ${widthM}.`);
  }
  return { kind: 'obb', halfExtents: vec2(lengthM / 2, widthM / 2) };
}

export function createCircle(radius: number): Circle {
  if (!(radius > 0)) throw new Error(`Circle needs a positive radius, got ${radius}.`);
  return { kind: 'circle', radius };
}

/**
 * Build a convex polygon from counter-clockwise local vertices.
 *
 * Convexity is checked rather than assumed: a concave polygon silently breaks
 * SAT, producing missed or wrong contacts that are very hard to trace back.
 * Concave field geometry must be decomposed into convex parts at load time.
 */
export function createPoly(vertices: readonly Vec2[]): ConvexPoly {
  if (vertices.length < 3) {
    throw new Error(`Polygon needs at least 3 vertices, got ${vertices.length}.`);
  }

  const n = vertices.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i] as Vec2;
    const b = vertices[(i + 1) % n] as Vec2;
    const c = vertices[(i + 2) % n] as Vec2;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) throw new Error('Polygon is not convex.');
  }
  if (sign < 0) throw new Error('Polygon vertices must be counter-clockwise.');

  return { kind: 'poly', vertices: vertices.map((v) => vec2(v.x, v.y)) };
}

/** Axis-aligned rectangle as a polygon, in world coordinates. */
export function createRectPoly(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): ConvexPoly {
  const hw = width / 2;
  const hh = height / 2;
  return createPoly([
    vec2(centerX - hw, centerY - hh),
    vec2(centerX + hw, centerY - hh),
    vec2(centerX + hw, centerY + hh),
    vec2(centerX - hw, centerY + hh),
  ]);
}

/** Local-frame vertices of a polygonal shape. Circles have none. */
export function localVertices(shape: Obb | ConvexPoly): readonly Vec2[] {
  if (shape.kind === 'poly') return shape.vertices;
  const { x, y } = shape.halfExtents;
  return [vec2(x, -y), vec2(x, y), vec2(-x, y), vec2(-x, -y)];
}

/** Transform a shape's vertices into world space. */
export function worldVertices(
  shape: Obb | ConvexPoly,
  position: Vec2,
  theta: number,
): readonly Vec2[] {
  const local = localVertices(shape);
  const out: Vec2[] = new Array<Vec2>(local.length);
  for (let i = 0; i < local.length; i++) {
    const r = rotate(local[i] as Vec2, theta);
    out[i] = vec2(position.x + r.x, position.y + r.y);
  }
  return out;
}

/**
 * Shortest distance from a world point to an oriented box, and the point on the
 * box that achieves it. Zero distance means the point is inside.
 *
 * Solved in the box's own frame, where the nearest point is just the query
 * clamped to the half-extents. Cheaper and exact where a polygon-edge scan would
 * be approximate at the corners.
 */
export function closestPointOnObb(
  shape: Obb,
  position: Vec2,
  theta: number,
  point: Vec2,
): { readonly point: Vec2; readonly distance: number } {
  const local = rotate(vec2(point.x - position.x, point.y - position.y), -theta);
  const { x: hx, y: hy } = shape.halfExtents;

  const clamped = vec2(
    local.x < -hx ? -hx : local.x > hx ? hx : local.x,
    local.y < -hy ? -hy : local.y > hy ? hy : local.y,
  );

  const world = rotate(clamped, theta);
  const nearest = vec2(position.x + world.x, position.y + world.y);
  return { point: nearest, distance: Math.hypot(point.x - nearest.x, point.y - nearest.y) };
}

/** Bounding radius about the shape's own origin, used for broadphase padding. */
export function boundingRadius(shape: Shape): number {
  if (shape.kind === 'circle') return shape.radius;
  let maxSq = 0;
  for (const v of localVertices(shape)) {
    const d = v.x * v.x + v.y * v.y;
    if (d > maxSq) maxSq = d;
  }
  return Math.sqrt(maxSq);
}

export function shapeAabb(shape: Shape, position: Vec2, theta: number): Aabb {
  if (shape.kind === 'circle') {
    return {
      minX: position.x - shape.radius,
      minY: position.y - shape.radius,
      maxX: position.x + shape.radius,
      maxY: position.y + shape.radius,
    };
  }

  const verts = worldVertices(shape, position, theta);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

export function aabbOverlaps(a: Aabb, b: Aabb): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
