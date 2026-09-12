/**
 * BIOBUZZ field layout.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SIZES ARE SOURCED (`biobuzzDimensions.ts`). POSITIONS ARE INFERRED OR
 *  ASSUMED — THE MANUAL PUBLISHES THEM ONLY AS FIGURES THIS PASS CANNOT READ.
 *
 *  Unlike DECODE, this manual gives no TILE-coordinate table for BIOBUZZ's
 *  field elements — Figures 9-4/9-5 (TILE grid) and 10-2 (staging) are the
 *  only source, and they are diagrams, not text. Every position below is
 *  therefore `inferred` (reasoned from the manual's own descriptive language:
 *  "located in the center of the FIELD", "attached to the perimeter wall",
 *  "opposite corners") or `assumed` (an engineering placement where the text
 *  gives no directional hint at all). None is `explicit`.
 *
 *  To finish: audit every position here against the official 3D CAD model
 *  once it is available, the same next step DECODE's own layout still has
 *  open. Region/zone ids are the contract with `biobuzz.ts` and must not
 *  change.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { inferred, type Sourced } from '../sourced.js';
import {
  createCircleRegion,
  createRectRegion,
  createRectZone,
  type FieldRegion,
  type FieldZone,
} from '../regions.js';
import { vec2 } from '../../math/vec2.js';
import { inchesToMeters } from '../../units/convert.js';
import type { Pose } from '../../physics/body.js';
import { FIELD_SIZE_IN, FLOWER, GARDEN, HIVE_CELL, HIVE_FRAME, LOADING_ZONE } from './biobuzzDimensions.js';

const HALF = FIELD_SIZE_IN / 2;

/** Provenance note for the layout as a whole — see the file banner. */
export const BIOBUZZ_LAYOUT_PROVENANCE: Sourced<string> = inferred(
  'BIOBUZZ field element positions (HIVE, FLOWERs, GARDENs, LOADING ZONEs) are ' +
    'reasoned from the manual\'s descriptive language, not read from a TILE grid ' +
    'or CAD model — neither is available to this pass.',
  'Section 9 ARENA gives sizes throughout but places elements only in Figures ' +
    '9-2 through 9-13, none of which render as extractable text.',
);

export const BIOBUZZ_REGIONS = {
  redCellNear: 'red-cell-near',
  redCellFar: 'red-cell-far',
  blueCellNear: 'blue-cell-near',
  blueCellFar: 'blue-cell-far',
  flowerNorth: 'flower-north',
  flowerSouth: 'flower-south',
  flowerEast: 'flower-east',
  flowerWest: 'flower-west',
  redGarden: 'red-garden',
  blueGarden: 'blue-garden',
} as const;

export const BIOBUZZ_ZONES = {
  redLoadingZone: 'red-loading-zone',
  blueLoadingZone: 'blue-loading-zone',
  wallContactNorth: 'wall-contact-north',
  wallContactSouth: 'wall-contact-south',
  wallContactEast: 'wall-contact-east',
  wallContactWest: 'wall-contact-west',
} as const;

/** Every zone id a LEAVE rule must confirm the robot has no support in. */
export const WALL_CONTACT_ZONE_IDS: readonly string[] = [
  BIOBUZZ_ZONES.wallContactNorth,
  BIOBUZZ_ZONES.wallContactSouth,
  BIOBUZZ_ZONES.wallContactEast,
  BIOBUZZ_ZONES.wallContactWest,
];

/**
 * HIVE CELL centres. "A frame holds a red HIVE and a blue HIVE" (§9.6, p.69)
 * sitting "in the center of the FIELD" (§8, p.62): read as the 49.46 in frame
 * split down the middle, one HIVE's pair of CELLs on each alliance's half,
 * each pair separated by the sourced 18.8 in along the audience-to-far axis.
 * `inferred`: the manual states the frame is centred and gives the CELL
 * separation, but never says which axis that separation runs along, or that
 * the two HIVEs sit side by side rather than front-to-back.
 */
const HIVE_HALF_SEPARATION_IN = HIVE_FRAME.widthIn.value / 4;
const CELL_HALF_SEPARATION_IN = HIVE_CELL.separationIn.value / 2;

function cellRegion(id: string, centerXIn: number, centerYIn: number): FieldRegion {
  return createRectRegion({
    id,
    centerXIn,
    centerYIn,
    widthIn: HIVE_CELL.openingWidthIn.value,
    lengthIn: HIVE_CELL.openingDepthIn.value,
    // The pivot is 43.95 in up; the opening is 14 in tall. Assumed rather than
    // inferred, because nothing in the manual says how far below the pivot
    // the CELL floor actually sits — this places its floor a reasoned 14 in
    // below the pivot and treats the whole opening height as the band a
    // resting piece counts as "in" the CELL.
    bottomIn: HIVE_FRAME.pivotHeightIn.value - HIVE_CELL.openingHeightIn.value,
    topIn: HIVE_FRAME.pivotHeightIn.value,
  });
}

export const BIOBUZZ_FIELD_REGIONS: readonly FieldRegion[] = [
  cellRegion(BIOBUZZ_REGIONS.redCellNear, -HIVE_HALF_SEPARATION_IN, -CELL_HALF_SEPARATION_IN),
  cellRegion(BIOBUZZ_REGIONS.redCellFar, -HIVE_HALF_SEPARATION_IN, CELL_HALF_SEPARATION_IN),
  cellRegion(BIOBUZZ_REGIONS.blueCellNear, HIVE_HALF_SEPARATION_IN, -CELL_HALF_SEPARATION_IN),
  cellRegion(BIOBUZZ_REGIONS.blueCellFar, HIVE_HALF_SEPARATION_IN, CELL_HALF_SEPARATION_IN),

  // Four FLOWERS "attached to the perimeter wall" (§9.7, p.72) with no count
  // per side stated: `assumed` one per wall, for maximum symmetry absent any
  // other hint.
  createCircleRegion({
    id: BIOBUZZ_REGIONS.flowerNorth,
    centerXIn: 0,
    centerYIn: HALF - 2,
    radiusIn: FLOWER.topOpeningDiameterIn.value / 2,
    bottomIn: FLOWER.topOpeningHeightIn.value - 8,
    topIn: FLOWER.topOpeningHeightIn.value,
  }),
  createCircleRegion({
    id: BIOBUZZ_REGIONS.flowerSouth,
    centerXIn: 0,
    centerYIn: -(HALF - 2),
    radiusIn: FLOWER.topOpeningDiameterIn.value / 2,
    bottomIn: FLOWER.topOpeningHeightIn.value - 8,
    topIn: FLOWER.topOpeningHeightIn.value,
  }),
  createCircleRegion({
    id: BIOBUZZ_REGIONS.flowerEast,
    centerXIn: HALF - 2,
    centerYIn: 0,
    radiusIn: FLOWER.topOpeningDiameterIn.value / 2,
    bottomIn: FLOWER.topOpeningHeightIn.value - 8,
    topIn: FLOWER.topOpeningHeightIn.value,
  }),
  createCircleRegion({
    id: BIOBUZZ_REGIONS.flowerWest,
    centerXIn: -(HALF - 2),
    centerYIn: 0,
    radiusIn: FLOWER.topOpeningDiameterIn.value / 2,
    bottomIn: FLOWER.topOpeningHeightIn.value - 8,
    topIn: FLOWER.topOpeningHeightIn.value,
  }),

  // GARDENs: "opposite corners of the FIELD", each "contacting the audience
  // or rear perimeter wall" (§9.3, p.66) and, per staging (§10.3.1, p.83),
  // "the corner closest to the ALLIANCE AREA". Read as: red's GARDEN in the
  // audience-side corner of red's own half, blue's in the diagonally opposite
  // (far-side) corner of blue's half.
  createRectRegion({
    id: BIOBUZZ_REGIONS.redGarden,
    centerXIn: -(HALF - GARDEN.widthIn.value / 2),
    centerYIn: -(HALF - GARDEN.depthIn.value / 2),
    widthIn: GARDEN.widthIn.value,
    lengthIn: GARDEN.depthIn.value,
  }),
  createRectRegion({
    id: BIOBUZZ_REGIONS.blueGarden,
    centerXIn: HALF - GARDEN.widthIn.value / 2,
    centerYIn: HALF - GARDEN.depthIn.value / 2,
    widthIn: GARDEN.widthIn.value,
    lengthIn: GARDEN.depthIn.value,
  }),
];

export const BIOBUZZ_FIELD_ZONES: readonly FieldZone[] = [
  // LOADING ZONE: "bounded by red or blue tape and the adjoining FIELD
  // perimeters" (§9.3, p.65-66), "belonging to the ALLIANCE with the adjacent
  // ALLIANCE AREA" — read as centred on each alliance's own perimeter wall.
  createRectZone({
    id: BIOBUZZ_ZONES.redLoadingZone,
    centerXIn: -(HALF - LOADING_ZONE.depthIn.value / 2),
    centerYIn: 0,
    widthIn: LOADING_ZONE.depthIn.value,
    lengthIn: LOADING_ZONE.widthIn.value,
  }),
  createRectZone({
    id: BIOBUZZ_ZONES.blueLoadingZone,
    centerXIn: HALF - LOADING_ZONE.depthIn.value / 2,
    centerYIn: 0,
    widthIn: LOADING_ZONE.depthIn.value,
    lengthIn: LOADING_ZONE.widthIn.value,
  }),

  // Thin bands hugging the inside of each perimeter wall, `assumed` rather
  // than read from any rule: LEAVE (§10.5.4) asks whether a ROBOT is
  // "contacting the perimeter wall", a physical-contact fact this engine does
  // not track directly. A margin this narrow (2 in) is crossed only by a
  // robot actually touching or nearly touching the wall, which is what the
  // rule means; `robotNotInZone` over all four then reads as "not touching
  // any wall".
  createRectZone({ id: BIOBUZZ_ZONES.wallContactNorth, centerXIn: 0, centerYIn: HALF - 1, widthIn: FIELD_SIZE_IN, lengthIn: 2 }),
  createRectZone({ id: BIOBUZZ_ZONES.wallContactSouth, centerXIn: 0, centerYIn: -(HALF - 1), widthIn: FIELD_SIZE_IN, lengthIn: 2 }),
  createRectZone({ id: BIOBUZZ_ZONES.wallContactEast, centerXIn: HALF - 1, centerYIn: 0, widthIn: 2, lengthIn: FIELD_SIZE_IN }),
  createRectZone({ id: BIOBUZZ_ZONES.wallContactWest, centerXIn: -(HALF - 1), centerYIn: 0, widthIn: 2, lengthIn: FIELD_SIZE_IN }),
];

/**
 * Where a BIOBUZZ robot legally starts (G304): fully on its own side of the
 * FIELD, touching the perimeter wall, not in the LOADING ZONE or a FLOWER.
 * `assumed`: the manual states the legality constraints but not a specific
 * starting pose, the same gap DECODE's own start poses filled.
 */
export const BIOBUZZ_LEGAL_START_POSES: Readonly<Record<'red' | 'blue', Pose>> = {
  // Heading 0 is +X (fieldTemplate.ts): red starts at the west wall facing
  // into the field (toward +X); blue starts at the east wall facing the
  // opposite way (toward -X).
  red: { p: vec2(inchesToMeters(-(HALF - 9)), inchesToMeters(0)), theta: 0 },
  blue: { p: vec2(inchesToMeters(HALF - 9), inchesToMeters(0)), theta: Math.PI },
};
