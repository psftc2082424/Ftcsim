/**
 * Narrowphase collision detection.
 *
 * Convex shapes are separated by the Separating Axis Theorem: two convex shapes
 * are disjoint if and only if some axis exists on which their projections do not
 * overlap. For polygons it suffices to test each edge normal of both shapes; if
 * every axis overlaps, the axis of *least* overlap gives the contact normal and
 * the penetration depth.
 *
 * The axis alone is not enough. A contact also has to say **where** the shapes
 * touch, because the resolver applies its impulse there and an impulse in the
 * wrong place produces a torque that does not physically exist. Polygon pairs
 * therefore produce a *manifold*: the least-overlap face is used as a reference
 * and the other shape's facing edge is clipped to it, giving one point for a
 * corner contact and two for a face-on one. `manifoldFrom` records the bug that
 * made this necessary.
 *
 * Sign convention throughout: the returned `normal` is a unit vector pointing
 * **from A toward B**. Separating the pair means moving B along +normal and A
 * along -normal.
 */

import { normalize, sub, vec2, type Vec2 } from '../math/vec2.js';
import { worldVertices, type Circle, type ConvexPoly, type Obb, type Shape } from './shapes.js';
import type { Pose } from './body.js';

/** One point of a contact manifold, in world space. */
export interface ContactPoint {
  readonly position: Vec2;
  /** Penetration at this point along the contact normal, always positive. */
  readonly depth: number;
}

export interface Contact {
  /** Unit vector from A toward B. */
  readonly normal: Vec2;
  /** Deepest penetration in the manifold, along `normal`. Always positive. */
  readonly depth: number;
  /** One point for a corner contact, two for a face-on contact. Never empty. */
  readonly points: readonly ContactPoint[];
}

/**
 * Tie-break margin, in metres, for choosing which shape owns the contact normal.
 *
 * Two boxes meeting exactly flat report identical separations for A's face and
 * B's face. Preferring A unless B is shallower by more than this makes the
 * choice a function of argument order rather than of floating-point noise, which
 * is what keeps `collide` reproducible.
 */
const REFERENCE_FACE_TIE_TOLERANCE = 1e-9;

interface FaceQuery {
  /** Index of the face with the greatest separation, i.e. the least overlap. */
  readonly index: number;
  /** Signed separation on that face. Negative means overlapping. */
  readonly separation: number;
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
 * How deeply `incident` reaches past each face of `reference`, keeping the face
 * it reaches past least.
 *
 * A positive result is a separating axis and proves the shapes are disjoint.
 */
function faceQuery(reference: readonly Vec2[], incident: readonly Vec2[]): FaceQuery {
  const normals = edgeNormals(reference);

  let bestIndex = 0;
  let bestSeparation = -Infinity;

  for (let i = 0; i < reference.length; i++) {
    const normal = normals[i] as Vec2;
    const origin = reference[i] as Vec2;

    let deepest = Infinity;
    for (const v of incident) {
      const distance = (v.x - origin.x) * normal.x + (v.y - origin.y) * normal.y;
      if (distance < deepest) deepest = distance;
    }

    if (deepest > bestSeparation) {
      bestSeparation = deepest;
      bestIndex = i;
    }
  }

  return { index: bestIndex, separation: bestSeparation };
}

/** The face of `vertices` most opposed to `referenceNormal` — the one in contact. */
function incidentFaceIndex(vertices: readonly Vec2[], referenceNormal: Vec2): number {
  const normals = edgeNormals(vertices);

  let bestIndex = 0;
  let bestDot = Infinity;
  for (let i = 0; i < normals.length; i++) {
    const normal = normals[i] as Vec2;
    const dot = normal.x * referenceNormal.x + normal.y * referenceNormal.y;
    if (dot < bestDot) {
      bestDot = dot;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Clip the segment `p1`–`p2` to the half-plane `dot(normal, p) <= offset`.
 *
 * Returns the surviving segment, or `null` when the segment lies wholly outside.
 * A segment clipped to a half-plane is still a segment, so the caller always
 * gets two points or nothing.
 */
function clipSegmentToPlane(
  p1: Vec2,
  p2: Vec2,
  normal: Vec2,
  offset: number,
): readonly [Vec2, Vec2] | null {
  const d1 = normal.x * p1.x + normal.y * p1.y - offset;
  const d2 = normal.x * p2.x + normal.y * p2.y - offset;

  if (d1 <= 0 && d2 <= 0) return [p1, p2];
  if (d1 > 0 && d2 > 0) return null;

  // Exactly one endpoint is outside; slide it back onto the plane.
  const t = d1 / (d1 - d2);
  const crossing = vec2(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t);
  return d1 <= 0 ? [p1, crossing] : [crossing, p2];
}

/**
 * Build the contact manifold for an overlapping polygon pair.
 *
 * **Why clipping and not a support point.** This used to return the single
 * deepest vertex of B along the contact normal, averaging ties. Against the
 * field perimeter that vertex set is the wall's *entire* inner face, so the
 * averaged point landed at the middle of the wall — up to 1.8 m from where the
 * robot actually touched it. The normal impulse then acted through a lever arm
 * that long, and a robot driving flat into a wall anywhere but the wall's exact
 * centre was spun and thrown sideways instead of stopped.
 *
 * Clipping the incident face to the reference face's extent gives the region the
 * shapes genuinely share: two points for a face-on contact, symmetric about the
 * touching face, so their impulses cancel in torque; one point for a corner
 * contact, which correctly still spins the robot.
 */
function manifoldFrom(
  vertsRef: readonly Vec2[],
  vertsInc: readonly Vec2[],
  refIndex: number,
): { readonly points: ContactPoint[]; readonly normal: Vec2 } | null {
  const refNormal = edgeNormals(vertsRef)[refIndex] as Vec2;
  const faceStart = vertsRef[refIndex] as Vec2;
  const faceEnd = vertsRef[(refIndex + 1) % vertsRef.length] as Vec2;

  const incIndex = incidentFaceIndex(vertsInc, refNormal);
  const incStart = vertsInc[incIndex] as Vec2;
  const incEnd = vertsInc[(incIndex + 1) % vertsInc.length] as Vec2;

  const tangent = normalize(sub(faceEnd, faceStart));
  if (!Number.isFinite(tangent.x) || !Number.isFinite(tangent.y)) return null;

  // Trim the incident face to the strip the reference face spans.
  const backward = vec2(-tangent.x, -tangent.y);
  const trimmedAtStart = clipSegmentToPlane(
    incStart,
    incEnd,
    backward,
    backward.x * faceStart.x + backward.y * faceStart.y,
  );
  if (trimmedAtStart === null) return null;

  const clipped = clipSegmentToPlane(
    trimmedAtStart[0],
    trimmedAtStart[1],
    tangent,
    tangent.x * faceEnd.x + tangent.y * faceEnd.y,
  );
  if (clipped === null) return null;

  // Keep only what lies behind the reference face. A corner contact leaves one
  // endpoint in front of it, and that endpoint is not touching anything.
  const faceOffset = refNormal.x * faceStart.x + refNormal.y * faceStart.y;
  const points: ContactPoint[] = [];
  for (const position of clipped) {
    const separation = refNormal.x * position.x + refNormal.y * position.y - faceOffset;
    if (separation > 0) continue;
    points.push({ position, depth: -separation });
  }

  if (points.length === 0) return null;
  return { points, normal: refNormal };
}

function polyPoly(vertsA: readonly Vec2[], vertsB: readonly Vec2[]): Contact | null {
  const queryA = faceQuery(vertsA, vertsB);
  if (queryA.separation > 0) return null;

  const queryB = faceQuery(vertsB, vertsA);
  if (queryB.separation > 0) return null;

  // The least-overlap face owns the contact normal. Ties go to A.
  const useB = queryB.separation > queryA.separation + REFERENCE_FACE_TIE_TOLERANCE;
  const manifold = useB
    ? manifoldFrom(vertsB, vertsA, queryB.index)
    : manifoldFrom(vertsA, vertsB, queryA.index);
  if (manifold === null) return null;

  // A reference normal points away from the shape that owns it, so B's faces
  // give B→A and have to be reversed to satisfy the A→B convention.
  const normal = useB ? vec2(-manifold.normal.x, -manifold.normal.y) : manifold.normal;

  let depth = 0;
  for (const point of manifold.points) {
    if (point.depth > depth) depth = point.depth;
  }

  return { normal, depth, points: manifold.points };
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

/** A circle touches at one point, so its manifold never needs clipping. */
function singlePoint(normal: Vec2, depth: number, position: Vec2): Contact {
  return { normal, depth, points: [{ position, depth }] };
}

/** Circle A against polygon B. Normal points from the circle toward the polygon. */
function circlePoly(center: Vec2, radius: number, vertsB: readonly Vec2[]): Contact | null {
  const closest = closestOnPoly(vertsB, center);

  if (closest.inside) {
    // Centre is inside the polygon: push out along the nearest face.
    const outward = closest.faceNormal;
    return singlePoint(vec2(-outward.x, -outward.y), radius + closest.insideDepth, closest.point);
  }

  const delta = sub(closest.point, center);
  const distance = Math.hypot(delta.x, delta.y);
  if (distance > radius) return null;
  if (distance === 0) return null;

  return singlePoint(
    vec2(delta.x / distance, delta.y / distance),
    radius - distance,
    closest.point,
  );
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
  return singlePoint(
    normal,
    sum - distance,
    vec2(centerA.x + normal.x * radiusA, centerA.y + normal.y * radiusA),
  );
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
      points: flipped.points,
    };
  }

  return polyPoly(
    polygonOf(shapeA as Obb | ConvexPoly, poseA),
    polygonOf(shapeB as Obb | ConvexPoly, poseB),
  );
}
