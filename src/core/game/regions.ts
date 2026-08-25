/**
 * Field regions and zones — placed geometry for the ids a GameDefinition scores
 * against.
 *
 * Until now a region has been an *id* that scripted events referenced
 * (ASSUMPTIONS.md §10.5). This module gives those ids shapes, so membership can
 * be decided from position rather than asserted by a test. It is the first half
 * of closing that gap; emitting events from the result is the second.
 *
 * ── Layering ───────────────────────────────────────────────────────────────
 *
 * Shape primitives come from `physics/shapes`, which ARCHITECTURE.md §3.2 places
 * at level 1 — deliberately below `physics` itself at level 2 — so that geometry
 * is shareable. Nothing here touches a body, a pose or the solver, and the
 * physics→rules channel remains the event queue.
 *
 * ── Units ──────────────────────────────────────────────────────────────────
 *
 * Shapes are stored in **SI metres**, because they are compared against body
 * positions. Game definitions are authored in inches, so the constructors take
 * inches and convert once — the same boundary rule the rest of `core/` follows.
 *
 * ── Regions versus zones ───────────────────────────────────────────────────
 *
 * A **region** holds game pieces and answers "is this piece inside?". A **zone**
 * holds robots and answers "how much of this robot is inside?", because games
 * routinely distinguish fully-supported from partially-supported (DECODE's BASE,
 * §10.5.3). They are separate types because those are different questions, not
 * because their geometry differs.
 */

import { inchesToMeters } from '../units/convert.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import {
  createCircle,
  createPoly,
  createRectPoly,
  worldVertices,
  type Circle,
  type ConvexPoly,
  type Obb,
} from '../physics/shapes.js';

/** Planar geometry a region or zone can occupy. Convex only, as SAT requires. */
export type RegionShape = ConvexPoly | Circle;

/**
 * Height band a region occupies, in metres above the floor.
 *
 * A goal three feet up is not entered by a piece rolling underneath it. Absent
 * span means the region extends floor-to-ceiling, which is the common case.
 */
export interface VerticalSpan {
  readonly bottomM: number;
  readonly topM: number;
}

export interface FieldRegion {
  readonly id: string;
  readonly shape: RegionShape;
  /** Centre of the shape in world metres, for circle tests and diagnostics. */
  readonly centerM: Vec2;
  readonly span?: VerticalSpan | undefined;
  /**
   * Number of ordered slots, when the region is a sequence rather than a bag.
   * Pattern scoring reads position, not just membership.
   */
  readonly slotCount?: number | undefined;
}

export interface FieldZone {
  readonly id: string;
  readonly shape: RegionShape;
  readonly centerM: Vec2;
  readonly span?: VerticalSpan | undefined;
}

// ------------------------------------------------------------ constructors ---

export interface RectSpec {
  readonly id: string;
  readonly centerXIn: number;
  readonly centerYIn: number;
  readonly widthIn: number;
  readonly lengthIn: number;
  readonly bottomIn?: number;
  readonly topIn?: number;
  readonly slotCount?: number;
}

function spanOf(bottomIn?: number, topIn?: number): VerticalSpan | undefined {
  if (bottomIn === undefined && topIn === undefined) return undefined;
  return {
    bottomM: inchesToMeters(bottomIn ?? 0),
    topM: inchesToMeters(topIn ?? Number.POSITIVE_INFINITY),
  };
}

/** Axis-aligned rectangular region, authored in inches. */
export function createRectRegion(spec: RectSpec): FieldRegion {
  const centerX = inchesToMeters(spec.centerXIn);
  const centerY = inchesToMeters(spec.centerYIn);

  return {
    id: spec.id,
    shape: createRectPoly(
      centerX,
      centerY,
      inchesToMeters(spec.widthIn),
      inchesToMeters(spec.lengthIn),
    ),
    centerM: vec2(centerX, centerY),
    span: spanOf(spec.bottomIn, spec.topIn),
    slotCount: spec.slotCount,
  };
}

export interface CircleSpec {
  readonly id: string;
  readonly centerXIn: number;
  readonly centerYIn: number;
  readonly radiusIn: number;
  readonly bottomIn?: number;
  readonly topIn?: number;
  readonly slotCount?: number;
}

/** Circular region, authored in inches. */
export function createCircleRegion(spec: CircleSpec): FieldRegion {
  const centerX = inchesToMeters(spec.centerXIn);
  const centerY = inchesToMeters(spec.centerYIn);

  return {
    id: spec.id,
    shape: createCircle(inchesToMeters(spec.radiusIn)),
    centerM: vec2(centerX, centerY),
    span: spanOf(spec.bottomIn, spec.topIn),
    slotCount: spec.slotCount,
  };
}

/** Region from explicit world-space vertices, for non-rectangular geometry. */
export function createPolyRegion(
  id: string,
  verticesIn: readonly Vec2[],
  options: { bottomIn?: number; topIn?: number; slotCount?: number } = {},
): FieldRegion {
  const vertices = verticesIn.map((v) => vec2(inchesToMeters(v.x), inchesToMeters(v.y)));

  let sumX = 0;
  let sumY = 0;
  for (const v of vertices) {
    sumX += v.x;
    sumY += v.y;
  }

  return {
    id,
    shape: createPoly(vertices),
    centerM: vec2(sumX / vertices.length, sumY / vertices.length),
    span: spanOf(options.bottomIn, options.topIn),
    slotCount: options.slotCount,
  };
}

/** A zone is a region asked a different question; construction is identical. */
export function createRectZone(spec: RectSpec): FieldZone {
  const { slotCount: _unused, ...region } = createRectRegion(spec);
  return region;
}

// ------------------------------------------------------------- membership ---

/**
 * Is a world point inside a convex shape?
 *
 * For a polygon this is the standard convex test: the point must lie on the
 * inner side of every edge. Vertices are already in world space for polygons
 * built by the constructors above, so `centerM` is used only by circles.
 *
 * A point exactly on a boundary counts as inside. Games describe scoring as
 * "in the goal", and excluding the boundary would make a piece resting exactly
 * on a line score or not score on a floating-point coin flip.
 */
export function shapeContainsPoint(shape: RegionShape, centerM: Vec2, point: Vec2): boolean {
  if (shape.kind === 'circle') {
    const dx = point.x - centerM.x;
    const dy = point.y - centerM.y;
    return dx * dx + dy * dy <= shape.radius * shape.radius;
  }

  const vertices = shape.vertices;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const a = vertices[i] as Vec2;
    const b = vertices[(i + 1) % n] as Vec2;
    // Counter-clockwise winding: an inside point is left of every edge, so the
    // cross product is non-negative.
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross < 0) return false;
  }
  return true;
}

/** Does a height fall within a region's vertical band? */
export function spanContainsHeight(span: VerticalSpan | undefined, heightM: number): boolean {
  if (span === undefined) return true;
  return heightM >= span.bottomM && heightM <= span.topM;
}

/**
 * Is a piece inside a region?
 *
 * `heightM` defaults to the floor, which is where a piece is unless a game
 * models pieces at height.
 */
export function regionContains(region: FieldRegion, point: Vec2, heightM = 0): boolean {
  if (!spanContainsHeight(region.span, heightM)) return false;
  return shapeContainsPoint(region.shape, region.centerM, point);
}

/**
 * Every region containing a point, in the order the regions were given.
 *
 * Order is preserved rather than sorted so a definition can express nesting —
 * `PieceCameToRest.regionIds` documents "innermost last", and that is the
 * definition's ordering to choose, not this function's.
 */
export function regionsContaining(
  regions: readonly FieldRegion[],
  point: Vec2,
  heightM = 0,
): readonly string[] {
  const found: string[] = [];
  for (const region of regions) {
    if (regionContains(region, point, heightM)) found.push(region.id);
  }
  return found;
}

// ------------------------------------------------------- robot occupancy ---

/**
 * Fraction of a robot's footprint inside a zone, from corner sampling.
 *
 * The robot's four corners are tested and the fraction inside returned, so the
 * result is one of 0, 0.25, 0.5, 0.75 or 1.
 *
 * **This is an approximation, and deliberately a coarse one.** Exact polygon
 * clipping would give a continuous fraction, but games do not ask for one: they
 * ask "fully inside" or "partially inside", and both endpoints are exact under
 * corner sampling — all four corners inside means fully inside for a convex
 * zone, and none inside means no overlap unless the zone is smaller than the
 * robot. That last case is the known failure: a zone entirely contained within
 * the robot's footprint reports 0. Recorded in ASSUMPTIONS.md §10.6.
 */
export function robotSupportFraction(
  zone: FieldZone,
  robotShape: Obb,
  robotPosition: Vec2,
  robotHeading: number,
): number {
  const corners = worldVertices(robotShape, robotPosition, robotHeading);

  let inside = 0;
  for (const corner of corners) {
    if (shapeContainsPoint(zone.shape, zone.centerM, corner)) inside++;
  }
  return inside / corners.length;
}

/** Convenience over `robotSupportFraction` for the common "is it all in?" test. */
export function robotFullyInZone(
  zone: FieldZone,
  robotShape: Obb,
  robotPosition: Vec2,
  robotHeading: number,
): boolean {
  return robotSupportFraction(zone, robotShape, robotPosition, robotHeading) === 1;
}

// ------------------------------------------------------------- validation ---

export interface RegionProblem {
  readonly regionId: string;
  readonly message: string;
}

/**
 * Check a region set before a match, in the same spirit as `validateRuleSet`:
 * a definition whose geometry is broken should fail loudly at load rather than
 * silently mis-score.
 */
export function validateRegions(regions: readonly FieldRegion[]): readonly RegionProblem[] {
  const problems: RegionProblem[] = [];
  const seen = new Set<string>();

  for (const region of regions) {
    if (seen.has(region.id)) {
      problems.push({ regionId: region.id, message: `Duplicate region id "${region.id}".` });
    }
    seen.add(region.id);

    if (region.span !== undefined && region.span.topM < region.span.bottomM) {
      problems.push({
        regionId: region.id,
        message: 'Vertical span is inverted: top is below bottom.',
      });
    }

    if (region.slotCount !== undefined && (!Number.isInteger(region.slotCount) || region.slotCount < 1)) {
      problems.push({
        regionId: region.id,
        message: `slotCount must be a positive integer, got ${region.slotCount}.`,
      });
    }
  }

  return problems;
}

/** Region ids a rule set references that no region provides. */
export function missingRegionIds(
  regions: readonly FieldRegion[],
  referencedIds: readonly string[],
): readonly string[] {
  const available = new Set(regions.map((r) => r.id));
  const missing = new Set<string>();
  for (const id of referencedIds) {
    if (!available.has(id)) missing.add(id);
  }
  return [...missing].sort();
}
