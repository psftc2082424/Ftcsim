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
import { createStaticBody, type RigidBody, type EntityId, type VerticalSpan } from '../physics/body.js';

/** The FTC field interior is 12 ft on a side. */
export const FIELD_SIZE_IN = 144;

/**
 * Perimeter wall height. FTC field perimeter panels are about 12 in tall.
 * Used only for the vertical-span test; nothing in Phase 1 can drive over a
 * wall, so the exact value has no effect until traversable elements exist.
 * ASSUMPTIONS.md §5.4.
 */
export const PERIMETER_WALL_HEIGHT_IN = 12;

/** Thickness given to the perimeter collision bodies. */
const WALL_THICKNESS_IN = 2;

export interface FieldTemplate {
  readonly id: string;
  readonly name: string;
  /** Interior playing area, metres. */
  readonly widthM: number;
  readonly lengthM: number;
  /** Static collision geometry. */
  readonly bodies: readonly RigidBody[];
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
