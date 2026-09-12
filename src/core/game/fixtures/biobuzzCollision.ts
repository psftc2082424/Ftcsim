/**
 * BIOBUZZ physical-collision fixture.
 *
 * Reuses the season-stable perimeter (`createStandardField`) and adds the two
 * kinds of physical structure BIOBUZZ has: the central HIVE Structure and the
 * four wall-mounted FLOWERs. Both are real, solid assemblies the manual
 * describes (§9.6, §9.7) but does not give a CAD footprint for, so their
 * collision bodies here are a deliberately simple, `assumed` approximation —
 * a full-footprint block for the HIVE frame and a small post for each
 * FLOWER — rather than an invented sub-part geometry. This is the same
 * "classify honestly, approximate visibly" position DECODE's own collision
 * fixture took before its CAD-backed pass, and it needs the same follow-up:
 * replace these with real sub-part footprints once the CAD is available.
 *
 * The CELLs and FLOWER scoring volumes themselves have no collision body —
 * they are `GameDefinition` regions, not obstacles, exactly as DECODE keeps
 * its GOAL opening passable while the GOAL shell around it is solid.
 */

import { createStandardField, type FieldTemplate } from '../../field/fieldTemplate.js';
import { createStaticBody, type EntityId, type VerticalSpan } from '../../physics/body.js';
import { createObb } from '../../physics/shapes.js';
import { vec2, type Vec2 } from '../../math/vec2.js';
import { inchesToMeters } from '../../units/convert.js';
import { HIVE_FRAME } from './biobuzzDimensions.js';
import { BIOBUZZ_FIELD_REGIONS, BIOBUZZ_REGIONS } from './biobuzzField.js';

/** Assumed footprint for a FLOWER's own wall-mounted post structure. */
const FLOWER_POST_FOOTPRINT_IN = 6;

/**
 * Assumed collision height for a FLOWER post and the HIVE frame — capped
 * *below* each structure's own scoring/resting band (FLOWER's scoring volume
 * starts at `FLOWER.topOpeningHeightIn - 8`; a CELL's resting band starts at
 * `HIVE_FRAME.pivotHeightIn - HIVE_CELL.openingHeightIn`, see
 * `biobuzzField.ts`). Both obstacles exist to block a ROBOT from driving
 * through the structure's base, not to fill the hollow scoring pocket a real
 * ROBOT or ARTIFACT never contacts at floor level — a taller block would
 * physically trap a piece this fixture holds up there (`tipper.ts`,
 * `elevatedRegion.ts`) inside solid matter.
 */
const LOW_STRUCTURE_HEIGHT_IN = 12;

function flowerCenterM(regionId: string): Vec2 {
  const region = BIOBUZZ_FIELD_REGIONS.find((r) => r.id === regionId);
  if (region === undefined) throw new Error(`No FLOWER region "${regionId}".`);
  return region.centerM;
}

export function createBiobuzzField(firstEntityId: EntityId = 1000): FieldTemplate {
  const base = createStandardField();

  const hiveSpan: VerticalSpan = { bottom: 0, top: inchesToMeters(LOW_STRUCTURE_HEIGHT_IN) };
  const hiveBody = createStaticBody({
    id: firstEntityId,
    shape: createObb(inchesToMeters(HIVE_FRAME.widthIn.value), inchesToMeters(HIVE_FRAME.depthIn.value)),
    span: hiveSpan,
    pose: { p: vec2(0, 0), theta: 0 },
  });

  const flowerSpan: VerticalSpan = { bottom: 0, top: inchesToMeters(LOW_STRUCTURE_HEIGHT_IN) };
  const flowerRegionIds = [
    BIOBUZZ_REGIONS.flowerNorth,
    BIOBUZZ_REGIONS.flowerSouth,
    BIOBUZZ_REGIONS.flowerEast,
    BIOBUZZ_REGIONS.flowerWest,
  ];
  const flowerBodies = flowerRegionIds.map((regionId, index) =>
    createStaticBody({
      id: firstEntityId + 1 + index,
      shape: createObb(inchesToMeters(FLOWER_POST_FOOTPRINT_IN), inchesToMeters(FLOWER_POST_FOOTPRINT_IN)),
      span: flowerSpan,
      pose: { p: flowerCenterM(regionId), theta: 0 },
    }),
  );

  return {
    ...base,
    id: 'biobuzz-2026',
    name: 'BIOBUZZ Field',
    bodies: [...base.bodies, hiveBody, ...flowerBodies],
  };
}
