/**
 * Field templates.
 *
 * The FTC playing field has been a 12 ft × 12 ft square of soft tiles inside a
 * perimeter wall for many seasons. That geometry is season-*stable*, so it is a
 * template here rather than something a game-manual parser has to rediscover
 * every year (ARCHITECTURE.md §6.2). Season-specific structures will be added as
 * `elements` on top of a template when GameDefinition lands in Phase 3.
 *
 * World frame: origin at the field centre, +X toward the right wall, +Y toward
 * the far wall, heading 0 along +X, positive rotation counter-clockwise.
 * Centring the origin keeps the field symmetric about both axes, which makes
 * alliance mirroring a sign flip instead of an offset.
 */

import { inchesToMeters } from '../units/convert.js';
import { createObb } from '../physics/shapes.js';
import { vec2 } from '../math/vec2.js';
import { createStaticBody, type RigidBody, type EntityId, type VerticalSpan, type Pose } from '../physics/body.js';
import type { Vec2 } from '../math/vec2.js';

/** The FTC field interior is 12 ft on a side. */
export const FIELD_SIZE_IN = 144;

/**
 * Perimeter wall height. FTC field perimeter panels are about 12 in tall.
 * Used only for the vertical-span test; nothing in Phase 1 can drive over a
 * wall, so the exact value has no effect until traversable elements exist.
 * ASSUMPTIONS.md §5.4.
 */
export const PERIMETER_WALL_HEIGHT_IN = 12;

/**
 * Thickness given to the perimeter collision bodies.
 *
 * Only the *inner face* is gameplay: walls are placed outside the playing area,
 * so the interior measures exactly 144 in whatever this is. The depth behind
 * that face is a modelling choice, and it was 2 in, which was too thin to be
 * safe.
 *
 * A circle whose centre crosses a wall's midline is nearer the far face than
 * the near one, and `circlePoly` pushes an enclosed centre out through
 * whichever face is nearest — so a 4.9 in artifact squeezed by 2 in of wall
 * popped out the back and left the field (ASSUMPTIONS.md §5.8). 12 in exceeds
 * any FTC scoring element, so no piece can be squeezed far enough to flip
 * which face is nearest, and it is roughly the depth of the real perimeter
 * structure rather than a number picked to be large.
 */
const WALL_THICKNESS_IN = 12;

export interface FieldTemplate {
  readonly id: string;
  readonly name: string;
  /** Interior playing area, metres. */
  readonly widthM: number;
  readonly lengthM: number;
  /** Static collision geometry. */
  readonly bodies: readonly RigidBody[];
  /**
   * Named groups of static colliders whose state is owned by a field mechanism.
   *
   * A GameDefinition refers to a stable semantic tag ("gate", "door", or
   * "chute-latch"), never a physics entity id. The world can then disable an
   * open gate without a season fixture reaching into its body map.
   */
  readonly colliderTags?: Readonly<Record<string, readonly EntityId[]>> | undefined;
  /**
   * Canonical season-fixture assemblies.  An assembly is presentation data
   * first, with an optional static collider on the exact same part.  This
   * prevents a renderer from reverse-engineering visual structures from body
   * thicknesses or rule-region rectangles.
   */
  readonly assemblies?: readonly FieldAssembly[] | undefined;
}

/** Neutral physical materials used by the 2D field renderer. */
export type FieldMaterial = 'metal' | 'panel' | 'ramp' | 'tape' | 'alliance-tape' | 'floor';

/** A top-down primitive sufficient for the seasonal fixture presentations. */
export type FieldAssemblyGeometry =
  | { readonly kind: 'obb'; readonly widthM: number; readonly lengthM: number; readonly pose: Pose }
  | { readonly kind: 'polygon'; readonly vertices: readonly Vec2[] };

/**
 * Collision metadata for an OBB assembly part.
 *
 * `tag` is optional because only live mechanisms such as a gate need a named
 * handle.  Static parts are converted into ordinary static rigid bodies by the
 * season fixture; the renderer consumes the same `geometry` regardless.
 */
export interface FieldAssemblyCollider {
  readonly id: EntityId;
  readonly span: VerticalSpan;
  readonly tag?: string | undefined;
}

export interface FieldAssemblyPart {
  readonly id: string;
  readonly geometry: FieldAssemblyGeometry;
  readonly material: FieldMaterial;
  readonly elevation: VerticalSpan;
  readonly collider?: FieldAssemblyCollider | undefined;
  /** Rule ids this physical part bounds or presents; never a collider source. */
  readonly semanticIds?: readonly string[] | undefined;
  /** Authoring-only outlines and labels are hidden in normal play. */
  readonly debugOnly?: boolean | undefined;
}

/** A reusable physical field object: e.g. one mirrored GOAL/ramp/tunnel set. */
export interface FieldAssembly {
  readonly id: string;
  readonly parts: readonly FieldAssemblyPart[];
}

export interface FieldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Build the standard 12 ft × 12 ft field.
 *
 * Walls are placed *outside* the playing area, so the interior measures exactly
 * 144 in across and a robot's legal region is the full field.
 */
export function createStandardField(firstEntityId: EntityId = 1000): FieldTemplate {
  const size = inchesToMeters(FIELD_SIZE_IN);
  const half = size / 2;
  const thickness = inchesToMeters(WALL_THICKNESS_IN);
  const halfThickness = thickness / 2;

  const span: VerticalSpan = {
    bottom: 0,
    top: inchesToMeters(PERIMETER_WALL_HEIGHT_IN),
  };

  // Long walls overlap the corners so there is no gap for a body to squeeze
  // through at the seams.
  const spanLength = size + thickness * 2;

  // Each wall is a box centred on its own pose, the same representation the
  // robot uses. Keeping "a body's pose is its centre" true for every body means
  // the renderer, the broadphase and any future spatial query can rely on it.
  const wallOffset = half + halfThickness;

  const walls: RigidBody[] = [
    // South (-Y): long in X, thin in Y.
    createStaticBody({
      id: firstEntityId,
      shape: createObb(spanLength, thickness),
      span,
      pose: { p: vec2(0, -wallOffset), theta: 0 },
    }),
    // North (+Y)
    createStaticBody({
      id: firstEntityId + 1,
      shape: createObb(spanLength, thickness),
      span,
      pose: { p: vec2(0, wallOffset), theta: 0 },
    }),
    // West (-X): thin in X, long in Y.
    createStaticBody({
      id: firstEntityId + 2,
      shape: createObb(thickness, spanLength),
      span,
      pose: { p: vec2(-wallOffset, 0), theta: 0 },
    }),
    // East (+X)
    createStaticBody({
      id: firstEntityId + 3,
      shape: createObb(thickness, spanLength),
      span,
      pose: { p: vec2(wallOffset, 0), theta: 0 },
    }),
  ];

  return {
    id: 'ftc-standard-12ft',
    name: 'FTC Standard 12 ft Field',
    widthM: size,
    lengthM: size,
    bodies: walls,
  };
}

/** Interior bounds of a field template, in metres. */
export function fieldBounds(field: FieldTemplate): FieldBounds {
  return {
    minX: -field.widthM / 2,
    maxX: field.widthM / 2,
    minY: -field.lengthM / 2,
    maxY: field.lengthM / 2,
  };
}
