/**
 * BIOBUZZ field layout.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  SIZES ARE SOURCED (`biobuzzDimensions.ts`). POSITIONS ARE NOW SOURCED TOO,
 *  FROM THE EVENT FIELD SETUP GUIDE'S TILE COORDINATES (`biobuzzTiles.ts`).
 *
 *  The Competition Manual places BIOBUZZ's field elements only in figures, so
 *  everything here used to be `inferred` or `assumed` from descriptive
 *  language. The **Event FIELD Setup Guide (V1.0)** gives the same placements
 *  against a published TILE grid, which is what an event actually builds to:
 *
 *    - LOADING ZONES: "[1] Red (on tile A5) and [1] Blue (on tile F2)" (S8.3)
 *    - GARDENS: "[1] Red Garden (on Tile A1) and [1] Blue Garden (on Tile F6)"
 *      (S8.4)
 *    - ALLIANCE AREAS: 54 in deep, "width is set based on Tile Seam 1 and Tile
 *      Seam 5" (S8.5)
 *    - HIVE frame: installed on the four centre TILES (S9.1-9.2)
 *
 *  What remains unsourced is called out where it sits: the FLOWER positions
 *  are read off Figure 6-2's plan view rather than named in text, and the CELL
 *  height band is still reasoned from the frame's pivot height.
 *
 *  Region/zone ids are the contract with `biobuzz.ts` and must not change.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { explicitRule, inferred, type Sourced } from '../sourced.js';
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
import {
  FIELD_SIZE_IN,
  FLOWER,
  GARDEN,
  HIVE_CELL,
  HIVE_FRAME,
  LOADING_ZONE,
  POLLEN_DIAMETER_IN,
} from './biobuzzDimensions.js';
import {
  horizontalSeamYIn,
  rowCenterYIn,
  tileBounds,
  verticalSeamXIn,
  type TileColumn,
  type TileRow,
} from './biobuzzTiles.js';

const HALF = FIELD_SIZE_IN / 2;

/** Provenance note for the layout as a whole — see the file banner. */
export const BIOBUZZ_LAYOUT_PROVENANCE: Sourced<string> = explicitRule(
  'BIOBUZZ field element positions are transcribed from the Event FIELD Setup ' +
    'Guide\'s TILE coordinates; only the FLOWER positions are read from its plan ' +
    'view rather than named in text.',
  'Setup Guide S6, S8, S9',
  'Tile coordinates are used to assist with field setup ... There are [2] Loading Zones: ' +
    '[1] Red (on tile A5) and [1] Blue (on tile F2) ... [1] Red Garden (on Tile A1) and ' +
    '[1] Blue Garden (on Tile F6).',
  8,
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

/**
 * Where each FLOWER meets the perimeter, read from Figure 6-2's plan view.
 *
 * The manual only says FLOWERs attach to the perimeter wall (§9.7) and the
 * setup guide only says they go "in [4] locations around the Field Perimeter"
 * (§10.1) — neither names the TILES. Figure 6-2 draws all four, each centred on
 * a TILE seam one seam off the middle of its own wall, in the 180-degree
 * rotationally symmetric arrangement every FTC field uses. Read against the
 * grid that is seam W on the far wall, seam Y on the audience wall, seam 4 on
 * blue's wall and seam 2 on red's.
 *
 * `inferred`, not `explicit`: a figure is being measured, not a sentence
 * transcribed.
 */
export const BIOBUZZ_FLOWER_PLACEMENT: Sourced<string> = inferred(
  'one FLOWER per perimeter wall, each on the TILE seam one seam off centre, ' +
    'rotationally symmetric about the field centre',
  'Read from the Event FIELD Setup Guide Figure 6-2, which draws the four FLOWERs at the ' +
    'perimeter on seams W (far wall), Y (audience wall), 4 (blue wall) and 2 (red wall). ' +
    'Neither the manual nor the guide states the TILES in text.',
  8,
);

/**
 * How far a FLOWER's centre sits inside the wall face.
 *
 * §10.1-10.3 installs a FLOWER with its Base Bracket passing *under* the
 * perimeter and its Bottom Ring resting on the tiles, so the ring is up
 * against the inner wall face. Its own 4 in top opening then puts the centre
 * one radius in.
 */
const FLOWER_INSET_IN = FLOWER.topOpeningDiameterIn.value / 2;

const FLOWER_PLACEMENTS: readonly { id: string; xIn: number; yIn: number }[] = [
  { id: BIOBUZZ_REGIONS.flowerNorth, xIn: verticalSeamXIn('W'), yIn: HALF - FLOWER_INSET_IN },
  { id: BIOBUZZ_REGIONS.flowerSouth, xIn: verticalSeamXIn('Y'), yIn: -(HALF - FLOWER_INSET_IN) },
  { id: BIOBUZZ_REGIONS.flowerEast, xIn: HALF - FLOWER_INSET_IN, yIn: horizontalSeamYIn(4) },
  { id: BIOBUZZ_REGIONS.flowerWest, xIn: -(HALF - FLOWER_INSET_IN), yIn: horizontalSeamYIn(2) },
];

/**
 * A GARDEN: the strip its tape encloses against the two corner walls.
 *
 * The guide tapes a GARDEN as a single line across one corner TILE, "Tape
 * Starts and Ends at inside edge of Tile A1 seams" (§8.4), and then stages
 * "[4] Pollen ... placed in a line such that they contact the Tape Lines of the
 * Garden, are approximately adjacent to both nearby Field Perimeter Walls"
 * (§11.3). Four POLLEN touching both the wall and the tape is what fixes the
 * tape's offset: one POLLEN diameter out from the wall, plus the tape's own
 * width. That strip is the scoring area, and it is deep enough to contain a
 * resting POLLEN's centre, which a 2 in tape line alone would not be.
 */
const GARDEN_DEPTH_IN = POLLEN_DIAMETER_IN.value + GARDEN.depthIn.value;

function gardenRegion(id: string, column: TileColumn, row: TileRow): FieldRegion {
  const bounds = tileBounds(column, row);
  // The GARDEN hugs whichever long wall its TILE touches: row 1 is the
  // audience wall, row 6 the far wall.
  const wallYIn = row === 1 ? -HALF : HALF;
  const inward = row === 1 ? 1 : -1;

  return createRectRegion({
    id,
    centerXIn: (bounds.minXIn + bounds.maxXIn) / 2,
    centerYIn: wallYIn + (inward * GARDEN_DEPTH_IN) / 2,
    widthIn: GARDEN.widthIn.value,
    lengthIn: GARDEN_DEPTH_IN,
  });
}

export const BIOBUZZ_FIELD_REGIONS: readonly FieldRegion[] = [
  cellRegion(BIOBUZZ_REGIONS.redCellNear, -HIVE_HALF_SEPARATION_IN, -CELL_HALF_SEPARATION_IN),
  cellRegion(BIOBUZZ_REGIONS.redCellFar, -HIVE_HALF_SEPARATION_IN, CELL_HALF_SEPARATION_IN),
  cellRegion(BIOBUZZ_REGIONS.blueCellNear, HIVE_HALF_SEPARATION_IN, -CELL_HALF_SEPARATION_IN),
  cellRegion(BIOBUZZ_REGIONS.blueCellFar, HIVE_HALF_SEPARATION_IN, CELL_HALF_SEPARATION_IN),

  ...FLOWER_PLACEMENTS.map(({ id, xIn, yIn }) =>
    createCircleRegion({
      id,
      centerXIn: xIn,
      centerYIn: yIn,
      radiusIn: FLOWER.topOpeningDiameterIn.value / 2,
      bottomIn: FLOWER.topOpeningHeightIn.value - 8,
      topIn: FLOWER.topOpeningHeightIn.value,
    }),
  ),

  gardenRegion(BIOBUZZ_REGIONS.redGarden, 'A', 1),
  gardenRegion(BIOBUZZ_REGIONS.blueGarden, 'F', 6),
];

/**
 * A LOADING ZONE: 11 in out from its own side wall, one TILE wide along it.
 *
 * "Installation begins by installing [2] segments that are each 11 in.
 * (27.95 cm) long along the tile side seams. Then connect them with a third
 * segment that spans between them" (§8.3) — so the depth runs perpendicular to
 * the wall and the width is the TILE's own span, matching §9.3's 23 x 11 in.
 */
function loadingZone(id: string, column: TileColumn, row: TileRow): FieldZone {
  // Column A is the -X wall, F the +X wall.
  const wallXIn = column === 'A' ? -HALF : HALF;
  const inward = column === 'A' ? 1 : -1;

  return createRectZone({
    id,
    centerXIn: wallXIn + (inward * LOADING_ZONE.depthIn.value) / 2,
    centerYIn: rowCenterYIn(row),
    widthIn: LOADING_ZONE.depthIn.value,
    lengthIn: LOADING_ZONE.widthIn.value,
  });
}

export const BIOBUZZ_FIELD_ZONES: readonly FieldZone[] = [
  // LOADING ZONE: the guide tapes it on one named TILE against that
  // alliance's own side wall — 11 in out from the perimeter, spanning the
  // TILE between its two side seams (§8.3). Red is A5, blue is F2.
  loadingZone(BIOBUZZ_ZONES.redLoadingZone, 'A', 5),
  loadingZone(BIOBUZZ_ZONES.blueLoadingZone, 'F', 2),

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
 *
 * Each alliance's own side wall carries two obstructions it has to start clear
 * of, and they are not mirrored: red's LOADING ZONE is on A5 with its FLOWER
 * down on seam 2, blue's on F2 with its FLOWER up on seam 4. Backing onto the
 * TILE row furthest from both — row 4 for red, row 3 for blue — leaves an 18
 * in robot clear of each by more than a robot's own half-width, where the
 * other row would leave barely an inch beside the FLOWER.
 */
export const BIOBUZZ_LEGAL_START_POSES: Readonly<Record<'red' | 'blue', Pose>> = {
  // Heading 0 is +X (fieldTemplate.ts): red starts at the west wall facing
  // into the field (toward +X); blue starts at the east wall facing the
  // opposite way (toward -X). Half an 18 in robot off the wall puts its
  // bumper against it.
  red: {
    p: vec2(inchesToMeters(-(HALF - 9)), inchesToMeters(rowCenterYIn(4))),
    theta: 0,
  },
  blue: {
    p: vec2(inchesToMeters(HALF - 9), inchesToMeters(rowCenterYIn(3))),
    theta: Math.PI,
  },
};
