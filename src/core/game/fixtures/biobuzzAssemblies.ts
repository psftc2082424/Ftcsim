/**
 * Canonical BIOBUZZ HIVE and FLOWER assemblies.
 *
 * `biobuzzField.ts` places the CELLs and FLOWERs as `GameDefinition` regions —
 * where a piece counts as "in" one. This file is the physical structure
 * around those same positions: what a HIVE and a FLOWER actually look like,
 * and (for the HIVE's own support legs) what a ROBOT collides with. Following
 * the same split DECODE's `decodeAssemblies.ts` established: the renderer
 * reads these parts directly, and `biobuzzCollision.ts` derives static
 * colliders from the same OBB parts, so a visual structure and its collision
 * footprint can never drift apart.
 *
 * ── Why the HIVE is presented as legs + baskets + a frame spine ────────────
 *
 * The manual gives no CAD footprint for the Frame's own sub-parts, so this is
 * a deliberately simple, `assumed` approximation of what §9.6 describes: two
 * raised CELLs per HIVE, held up by a frame whose only floor contact is its
 * four corner legs (`biobuzzCollision.ts` derives their collider from the leg
 * parts here). The CELLs themselves sit at their real resting-band elevation
 * (`HIVE_FRAME.pivotHeightIn` down to that minus the CELL opening height) —
 * comfortably above a ROBOT — so the whole basket/spine presentation floats
 * above the field exactly where the real one does, and carries no collider of
 * its own: only the legs do.
 *
 * ── FLOWERs ─────────────────────────────────────────────────────────────────
 *
 * A FLOWER is drawn as a small octagonal marker at its own region's centre,
 * matching the real tube's round top opening (§9.7). It has no collider, for
 * the same reason `biobuzzCollision.ts` previously gave for removing its
 * post: the FLOWER's own staged POLLEN rest *inside* it, and a 2D collision
 * shape is convex, so it has no inside for them to occupy.
 */

import type { FieldAssembly, FieldAssemblyPart } from '../../field/fieldTemplate.js';
import { inchesToMeters } from '../../units/convert.js';
import { vec2, type Vec2 } from '../../math/vec2.js';
import { FLOWER, HIVE_CELL, HIVE_FRAME } from './biobuzzDimensions.js';
import { BIOBUZZ_FIELD_REGIONS, BIOBUZZ_REGIONS } from './biobuzzField.js';

/** Assumed footprint for one of the Frame's own corner legs — no CAD yet. */
export const HIVE_LEG_FOOTPRINT_IN = 3;

/**
 * Capped below a CELL's own resting band (`HIVE_FRAME.pivotHeightIn -
 * HIVE_CELL.openingHeightIn`), so the leg blocks a ROBOT at floor level
 * without reaching into the hollow CELL a resting piece occupies overhead.
 */
export const HIVE_LEG_HEIGHT_IN = 12;

/** Presentation band for the Frame's own connecting spine/crossbeam — well above ROBOT height, alongside the CELLs it visually joins. */
const BAR_HALF_THICKNESS_IN = 2;
const BAR_BOTTOM_IN = HIVE_FRAME.pivotHeightIn.value - BAR_HALF_THICKNESS_IN;
const BAR_TOP_IN = HIVE_FRAME.pivotHeightIn.value + BAR_HALF_THICKNESS_IN;

function regionCenterIn(id: string): { xIn: number; yIn: number } {
  const region = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === id);
  if (region === undefined) throw new Error(`No BIOBUZZ region "${id}".`);
  return { xIn: region.centerM.x / inchesToMeters(1), yIn: region.centerM.y / inchesToMeters(1) };
}

/**
 * One CELL's basket.
 *
 * Its collider is `transferOnly` (`fieldTemplate.ts`): the basket is a hollow
 * box a piece rests *inside*, and a 2D convex shape has no inside, so an
 * ordinary collider here would eject whatever the CELL is holding. What the
 * structure genuinely does is stand in the way of a shot crossing the middle
 * of the FIELD — a ROBOT lining up behind the HIVE and firing through it at
 * its own far CELL hits the near one. Nothing else in the world sees it: a
 * ROBOT is capped at 29 in and the basket starts at 29.95 in, so there was
 * never anything for a chassis to collide with here anyway.
 */
function basketPart(id: string, cellRegionId: string, colliderId: number): FieldAssemblyPart {
  const { xIn, yIn } = regionCenterIn(cellRegionId);
  return {
    id,
    collider: {
      id: colliderId,
      span: {
        bottom: inchesToMeters(HIVE_FRAME.pivotHeightIn.value - HIVE_CELL.openingHeightIn.value),
        top: inchesToMeters(HIVE_FRAME.pivotHeightIn.value),
      },
      transferOnly: true,
    },
    geometry: {
      kind: 'obb',
      widthM: inchesToMeters(HIVE_CELL.openingWidthIn.value),
      lengthM: inchesToMeters(HIVE_CELL.openingDepthIn.value),
      pose: { p: vec2(inchesToMeters(xIn), inchesToMeters(yIn)), theta: 0 },
    },
    material: 'panel',
    elevation: {
      bottom: inchesToMeters(HIVE_FRAME.pivotHeightIn.value - HIVE_CELL.openingHeightIn.value),
      top: inchesToMeters(HIVE_FRAME.pivotHeightIn.value),
    },
    semanticIds: [cellRegionId],
  };
}

/** The spine joining one alliance's two CELLs, drawn along their own axis. */
function spinePart(id: string, nearCellId: string, farCellId: string): FieldAssemblyPart {
  const near = regionCenterIn(nearCellId);
  const far = regionCenterIn(farCellId);
  const centerXIn = (near.xIn + far.xIn) / 2;
  const centerYIn = (near.yIn + far.yIn) / 2;
  // A little longer than the bare cell-to-cell separation so the spine
  // visibly reaches into both baskets rather than stopping short of them.
  const lengthIn = Math.hypot(far.xIn - near.xIn, far.yIn - near.yIn) + HIVE_CELL.openingDepthIn.value;
  const theta = Math.atan2(far.yIn - near.yIn, far.xIn - near.xIn);
  return {
    id,
    geometry: {
      kind: 'obb',
      widthM: inchesToMeters(BAR_HALF_THICKNESS_IN * 1.5),
      lengthM: inchesToMeters(lengthIn),
      pose: { p: vec2(inchesToMeters(centerXIn), inchesToMeters(centerYIn)), theta },
    },
    material: 'metal',
    elevation: { bottom: inchesToMeters(BAR_BOTTOM_IN), top: inchesToMeters(BAR_TOP_IN) },
  };
}

function legPart(id: string, xIn: number, yIn: number, colliderId: number): FieldAssemblyPart {
  return {
    id,
    geometry: {
      kind: 'obb',
      widthM: inchesToMeters(HIVE_LEG_FOOTPRINT_IN),
      lengthM: inchesToMeters(HIVE_LEG_FOOTPRINT_IN),
      pose: { p: vec2(inchesToMeters(xIn), inchesToMeters(yIn)), theta: 0 },
    },
    material: 'metal',
    elevation: { bottom: 0, top: inchesToMeters(HIVE_LEG_HEIGHT_IN) },
    collider: { id: colliderId, span: { bottom: 0, top: inchesToMeters(HIVE_LEG_HEIGHT_IN) } },
  };
}

/**
 * One alliance's HIVE: two baskets, the spine joining them, and the two
 * frame legs on that alliance's own side of the Frame's footprint.
 */
function hiveAssembly(
  alliance: 'red' | 'blue',
  legColliderIds: readonly [number, number],
  basketColliderIds: readonly [number, number],
): FieldAssembly {
  const nearId = alliance === 'red' ? BIOBUZZ_REGIONS.redCellNear : BIOBUZZ_REGIONS.blueCellNear;
  const farId = alliance === 'red' ? BIOBUZZ_REGIONS.redCellFar : BIOBUZZ_REGIONS.blueCellFar;

  // Legs sit at the Frame's own outer corners (its full 49.46 x 38.95 in
  // footprint), not under the baskets themselves. That is what leaves the
  // whole area beneath the raised CELLs — including straight through the
  // middle, between the red and blue HIVEs — open for a ROBOT to cross.
  const side = alliance === 'red' ? -1 : 1;
  const legXIn = side * (HIVE_FRAME.widthIn.value / 2);
  const halfDepthIn = HIVE_FRAME.depthIn.value / 2;

  return {
    id: `${alliance}-hive`,
    parts: [
      basketPart(`${alliance}-hive-basket-near`, nearId, basketColliderIds[0]),
      basketPart(`${alliance}-hive-basket-far`, farId, basketColliderIds[1]),
      spinePart(`${alliance}-hive-spine`, nearId, farId),
      legPart(`${alliance}-hive-leg-near`, legXIn, -halfDepthIn, legColliderIds[0]),
      legPart(`${alliance}-hive-leg-far`, legXIn, halfDepthIn, legColliderIds[1]),
    ],
  };
}

/** The crossbeam joining the red and blue HIVEs — decorative only, well above ROBOT height. */
function crossbeamAssembly(): FieldAssembly {
  const redXIn = regionCenterIn(BIOBUZZ_REGIONS.redCellNear).xIn;
  const blueXIn = regionCenterIn(BIOBUZZ_REGIONS.blueCellNear).xIn;
  const widthIn = Math.abs(blueXIn - redXIn) + HIVE_CELL.openingWidthIn.value;
  return {
    id: 'hive-frame',
    parts: [
      {
        id: 'hive-crossbeam',
        geometry: {
          kind: 'obb',
          widthM: inchesToMeters(widthIn),
          lengthM: inchesToMeters(BAR_HALF_THICKNESS_IN * 1.5),
          pose: { p: vec2(0, 0), theta: 0 },
        },
        material: 'metal',
        elevation: { bottom: inchesToMeters(BAR_BOTTOM_IN), top: inchesToMeters(BAR_TOP_IN) },
      },
    ],
  };
}

/** A regular polygon's vertices, world metres, for a rounded top-down marker. */
function regularPolygon(centerM: Vec2, radiusM: number, sides: number): readonly Vec2[] {
  return Array.from({ length: sides }, (_unused, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return vec2(centerM.x + radiusM * Math.cos(angle), centerM.y + radiusM * Math.sin(angle));
  });
}

/**
 * Presentation-only marker radius for a FLOWER, deliberately larger than the
 * sourced 4 in top-opening diameter (`FLOWER.topOpeningDiameterIn`) so the
 * marker still reads as a distinct structure around the 4 staged POLLEN
 * resting at its base (§11.2) instead of vanishing entirely underneath them.
 * The scoring region itself (`biobuzzField.ts`) still uses the sourced
 * diameter — this only widens what gets drawn.
 */
const FLOWER_MARKER_RADIUS_IN = 6;

function flowerAssembly(regionId: string): FieldAssembly {
  const { xIn, yIn } = regionCenterIn(regionId);
  const centerM = vec2(inchesToMeters(xIn), inchesToMeters(yIn));
  const radiusM = inchesToMeters(FLOWER_MARKER_RADIUS_IN);
  return {
    id: `${regionId}-assembly`,
    parts: [
      {
        id: `${regionId}-marker`,
        geometry: { kind: 'polygon', vertices: regularPolygon(centerM, radiusM, 8) },
        material: 'panel',
        elevation: { bottom: 0, top: inchesToMeters(FLOWER.backstopHeightIn.value) },
        semanticIds: [regionId],
      },
    ],
  };
}

/**
 * All of BIOBUZZ's canonical assemblies. `colliderIdBase` reserves 8
 * consecutive entity ids: the HIVE's 4 corner legs (2 per alliance), then its
 * 4 baskets (2 per alliance, shot blockers only).
 */
export function createBiobuzzAssemblies(colliderIdBase: number): readonly FieldAssembly[] {
  return [
    hiveAssembly('red', [colliderIdBase, colliderIdBase + 1], [colliderIdBase + 4, colliderIdBase + 5]),
    hiveAssembly('blue', [colliderIdBase + 2, colliderIdBase + 3], [colliderIdBase + 6, colliderIdBase + 7]),
    crossbeamAssembly(),
    flowerAssembly(BIOBUZZ_REGIONS.flowerNorth),
    flowerAssembly(BIOBUZZ_REGIONS.flowerSouth),
    flowerAssembly(BIOBUZZ_REGIONS.flowerEast),
    flowerAssembly(BIOBUZZ_REGIONS.flowerWest),
  ];
}
