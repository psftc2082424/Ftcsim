/**
 * Narrowphase collision detection.
 *
 * Convex shapes are separated by the Separating Axis Theorem: two convex shapes
 * are disjoint if and only if some axis exists on which their projections do not
 * overlap. For polygons it suffices to test each edge normal of both shapes; if
 * every axis overlaps, the axis of *least* overlap gives both the contact normal
 * and the penetration depth, which is exactly what the resolver needs.
 *
 * Sign convention throughout: the returned `normal` is a unit vector pointing
 * **from A toward B**. Separating the pair means moving B along +normal and A
 * along -normal.
 */

import { normalize, sub, vec2, type Vec2 } from '../math/vec2.js';
import { worldVertices, type Circle, type ConvexPoly, type Obb, type Shape } from './shapes.js';
import type { Pose } from './body.js';

export interface Contact {
  /** Unit vector from A toward B. */
  readonly normal: Vec2;
  /** Penetration depth along `normal`, always positive. */
  readonly depth: number;
  /** Representative world-space contact point. */
  readonly point: Vec2;
}

/**
 * Tolerance for treating several vertices as equally deep along the contact
 * normal. Face-on contacts have two corners at the same depth; averaging them
 * puts the contact point in the middle of the touching face instead of at one
 * corner, which stops a robot squaring up against a wall from being given a
 * spurious spin.
 */
const COINCIDENT_DEPTH_TOLERANCE = 1e-9;

interface Projection {
  readonly min: number;
  readonly max: number;
}

function project(vertices: readonly Vec2[], axis: Vec2): Projection {
  let min = Infinity;
  let max = -Infinity;
  for (const v of vertices) {
    const d = v.x * axis.x + v.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/** Outward edge normals of a counter-clockwise polygon. */
function edgeNormals(vertices: readonly Vec2[]): Vec2[] {
  const n = vertices.length;
  const normals: Vec2[] = new Array<Vec2>(n);
  for (let i = 0; i < n; i++) {
    const a = vertices[i] as Vec2;
    const b = vertices[(i + 1) % n] as Vec2;
    normals[i] = normalize(vec2(b.y - a.y, -(b.x - a.x)));
  }
  return normals;
}

/**
 * Average of the vertices furthest along `direction`. Ties within
 * `COINCIDENT_DEPTH_TOLERANCE` are averaged; a single extremal vertex is
 * returned unchanged.
 */
function supportPoint(vertices: readonly Vec2[], direction: Vec2): Vec2 {
  let best = -Infinity;
  for (const v of vertices) {
    const d = v.x * direction.x + v.y * direction.y;
    if (d > best) best = d;
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const v of vertices) {
    const d = v.x * direction.x + v.y * direction.y;
    if (d >= best - COINCIDENT_DEPTH_TOLERANCE) {
      sumX += v.x;
      sumY += v.y;
      count++;
    }
  }
  return vec2(sumX / count, sumY / count);
}

function polyPoly(vertsA: readonly Vec2[], vertsB: readonly Vec2[]): Contact | null {
  const axes = [...edgeNormals(vertsA), ...edgeNormals(vertsB)];

  let bestDepth = Infinity;
  let bestAxis: Vec2 | null = null;

  for (const axis of axes) {
    const pa = project(vertsA, axis);
    const pb = project(vertsB, axis);

    // A gap on any axis proves separation; stop immediately.
    if (pa.max < pb.min || pb.max < pa.min) return null;

    // Two ways to separate along this axis. The smaller one also tells us which
    // side B sits on, so direction comes straight out of the projections.
    //
    // Deriving it this way rather than from the two bodies' poses matters: a
    // static body may carry world-space vertices with its pose left at the
    // origin, in which case a pose-based test reverses the normal and the
    // resolver pushes bodies *through* each other instead of apart.
    const pushPositive = pa.max - pb.min; // B lies on the +axis side of A
    const pushNegative = pb.max - pa.min; // B lies on the -axis side of A

    const positive = pushPositive < pushNegative;
    const depth = positive ? pushPositive : pushNegative;

    if (depth < bestDepth) {
      bestDepth = depth;
      bestAxis = positive ? axis : vec2(-axis.x, -axis.y);
    }
  }

  if (bestAxis === null) return null;

  // The contact sits on B's surface that is deepest into A.
  const point = supportPoint(vertsB, vec2(-bestAxis.x, -bestAxis.y));

  return { normal: bestAxis, depth: bestDepth, point };
}

/** Closest point on a convex polygon's boundary to `p`, plus whether p is inside. */
function closestOnPoly(
  vertices: readonly Vec2[],
  p: Vec2,
): { point: Vec2; inside: boolean; faceNormal: Vec2; insideDepth: number } {
  const n = vertices.length;
  const normals = edgeNormals(vertices);

  let inside = true;
  let bestFaceDepth = Infinity;
  let bestFaceNormal = normals[0] as Vec2;

  for (let i = 0; i < n; i++) {
    const a = vertices[i] as Vec2;
    const normal = normals[i] as Vec2;
    const signedDistance = (p.x - a.x) * normal.x + (p.y - a.y) * normal.y;
    if (signedDistance > 0) inside = false;
    const depth = -signedDistance;
    if (depth < bestFaceDepth) {
      bestFaceDepth = depth;
      bestFaceNormal = normal;
    }
  }

  if (inside) {
    return {
      point: vec2(p.x + bestFaceNormal.x * bestFaceDepth, p.y + bestFaceNormal.y * bestFaceDepth),
      inside: true,
      faceNormal: bestFaceNormal,
      insideDepth: bestFaceDepth,
    };
  }

  // Outside: closest point is on some edge segment.
  let best = vec2(0, 0);
  let bestDistSq = Infinity;
  for (let i = 0; i < n; i++) {
    const a = vertices[i] as Vec2;
    const b = vertices[(i + 1) % n] as Vec2;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const lenSq = ex * ex + ey * ey;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / lenSq));
    const cx = a.x + ex * t;
    const cy = a.y + ey * t;
    const dSq = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = vec2(cx, cy);
    }
  }

  return { point: best, inside: false, faceNormal: bestFaceNormal, insideDepth: 0 };
}

/** Circle A against polygon B. Normal points from the circle toward the polygon. */
function circlePoly(center: Vec2, radius: number, vertsB: readonly Vec2[]): Contact | null {
  const closest = closestOnPoly(vertsB, center);

  if (closest.inside) {
    // Centre is inside the polygon: push out along the nearest face.
    const outward = closest.faceNormal;
    return {
      normal: vec2(-outward.x, -outward.y),
      depth: radius + closest.insideDepth,
      point: closest.point,
    };
  }

  const delta = sub(closest.point, center);
  const distance = Math.hypot(delta.x, delta.y);
  if (distance > radius) return null;
  if (distance === 0) return null;

  return {
    normal: vec2(delta.x / distance, delta.y / distance),
    depth: radius - distance,
    point: closest.point,
  };
}

function circleCircle(
  centerA: Vec2,
  radiusA: number,
  centerB: Vec2,
  radiusB: number,
): Contact | null {
  const delta = sub(centerB, centerA);
  const distance = Math.hypot(delta.x, delta.y);
  const sum = radiusA + radiusB;
  if (distance > sum) return null;

  // Concentric circles have no defined normal; nudge along +X deterministically
  // rather than producing NaN.
  const normal = distance === 0 ? vec2(1, 0) : vec2(delta.x / distance, delta.y / distance);
  const depth = sum - distance;
  return {
    normal,
    depth,
    point: vec2(centerA.x + normal.x * radiusA, centerA.y + normal.y * radiusA),
  };
}

function polygonOf(shape: Obb | ConvexPoly, pose: Pose): readonly Vec2[] {
  return worldVertices(shape, pose.p, pose.theta);
}

/**
 * Test two posed shapes. Returns `null` when they are separated, otherwise the
 * contact with normal pointing from A toward B.
 */
export function collide(shapeA: Shape, poseA: Pose, shapeB: Shape, poseB: Pose): Contact | null {
  const aIsCircle = shapeA.kind === 'circle';
  const bIsCircle = shapeB.kind === 'circle';

  if (aIsCircle && bIsCircle) {
    return circleCircle(poseA.p, (shapeA as Circle).radius, poseB.p, (shapeB as Circle).radius);
  }

  if (aIsCircle) {
    return circlePoly(poseA.p, (shapeA as Circle).radius, polygonOf(shapeB as Obb | ConvexPoly, poseB));
  }

  if (bIsCircle) {
    // Solve as circle-vs-polygon, then flip the normal back to the A→B convention.
    const flipped = circlePoly(
      poseB.p,
      (shapeB as Circle).radius,
      polygonOf(shapeA as Obb | ConvexPoly, poseA),
    );
    if (flipped === null) return null;
    return {
      normal: vec2(-flipped.normal.x, -flipped.normal.y),
      depth: flipped.depth,
      point: flipped.point,
    };
  }

  return polyPoly(
    polygonOf(shapeA as Obb | ConvexPoly, poseA),
    polygonOf(shapeB as Obb | ConvexPoly, poseB),
  );
}
