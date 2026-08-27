/**
 * DECODE's TILE coordinate system, and the world coordinates it maps to.
 *
 * §9.4 of the Competition Manual defines TILE coordinates but draws them only in
 * Figures 9-4 and 9-5, which is why this fixture's positions were invented for
 * so long. The **Event FIELD Setup Guide** publishes the same grid in text, and
 * places almost every element against it: "The red BASE ZONE is on TILE B2",
 * "SPIKE MARKS are placed on TILE pairs A4/B4, A3/B3, and A2/B2, each spanning
 * TILE seam V". That turns a guess into a transcription.
 *
 * ── The grid ───────────────────────────────────────────────────────────────
 *
 * 36 TILES, 6 x 6, each 24 in square (§9.2). Columns are lettered A-F and rows
 * numbered 1-6. The seams *between* tiles are named too, and the guide addresses
 * them constantly: vertical seams are V, W, X, Y, Z from one side to the other,
 * horizontal seams 1-5 from the audience inward.
 *
 * ── Which way round, and how it was settled ────────────────────────────────
 *
 * Two statements in the Competition Manual fix the orientation together:
 *
 *   - §9.5: "the red ALLIANCE AREA is located on the left from the primary
 *     audience viewing direction."
 *   - G402: "FIELD columns A, B, C constitute the blue side of the FIELD, and
 *     columns D, E, F ... constitute the red side."
 *
 * Red on the left and blue in columns A-C can only both be true if **A is on
 * the audience's right**, so the lettering runs right to left. The setup guide
 * agrees where it names the GATE ZONES — blue on A3/A4, red on F3/F4.
 *
 * Row 1 is the audience side: the front LAUNCH LINE spans "the [2] edge TILES
 * C1 and D1 centered on the audience side", and the LOADING ZONES are "in TILES
 * A1 and F1, in the corners on the audience side".
 *
 * Two checks fall out of this and both pass exactly, which is what makes the
 * mapping trustworthy rather than merely consistent:
 *
 *   - "TILE intersection X3", where the guide puts the apex of the back LAUNCH
 *     LINE, lands on (0, 0) — the field centre, as it says.
 *   - "TILE intersection X1", the apex of the front LAUNCH LINE, lands on
 *     (0, -48 in) — one TILE in from the audience wall, which is the 1-TILE
 *     depth §9.3 states.
 *
 * ── A conflict, recorded rather than resolved ──────────────────────────────
 *
 * The setup guide's colour labels for the BASE ZONES and SECRET TUNNEL ZONES
 * put red on the A-B side, which contradicts G402 and its own GATE ZONE
 * labels. `DECODE_SETUP_GUIDE_COLOUR_CONFLICT` records it. The Competition
 * Manual wins because it is the rules document, and the cost of being wrong is
 * bounded: the setup guide also says "The FIELD is symmetrical from right to
 * left, from the audience perspective", so a mistaken assignment mirrors the
 * colours and changes no distance and no rule.
 */

import { assumed, explicitRule, type Sourced } from '../sourced.js';
import { FIELD } from './decodeDimensions.js';

/** Columns run A-F from the audience's right to their left. */
export type TileColumn = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
/** Rows run 1-6 from the audience side inward. */
export type TileRow = 1 | 2 | 3 | 4 | 5 | 6;

/** Vertical seams, between columns: V is A|B, X is C|D and the centre line. */
export type VerticalSeam = 'V' | 'W' | 'X' | 'Y' | 'Z';
/** Horizontal seams, between rows: 1 is row 1|2, 3 is the centre line. */
export type HorizontalSeam = 1 | 2 | 3 | 4 | 5;

const COLUMNS: readonly TileColumn[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const VERTICAL_SEAMS: readonly VerticalSeam[] = ['V', 'W', 'X', 'Y', 'Z'];

const TILE_IN = FIELD.tileSideIn.value;
const GRID = 6;

export const DECODE_TILE_ORIENTATION: Sourced<string> = explicitRule(
  'columns A-F run right to left from the audience; rows 1-6 run away from it',
  'G402',
  'FIELD columns A, B, C constitute the blue side of the FIELD, and columns D, E, F (Figure 9-5) constitute the red side of the FIELD.',
  103,
);

export const DECODE_SETUP_GUIDE_COLOUR_CONFLICT: Sourced<string> = assumed(
  'manual wins for the BASE ZONE; the tunnel labels were never a conflict',
  'The Event FIELD Setup Guide places the red BASE ZONE on TILE B2 and the red SECRET ' +
    'TUNNEL ZONE on TILES A2/A3, while placing the *blue* GATE ZONE on A3/A4. Two of ' +
    'those looked like a contradiction and only one is. Section 9.8.3 says a GATE ' +
    'releases into the OPPOSING ALLIANCE SECRET TUNNEL ZONE, and G424.A contemplates a ' +
    'ROBOT standing in its own GATE ZONE and in the opponent SECRET TUNNEL at the same ' +
    'time - so a GATE and the tunnel beside it belong to different alliances by design, ' +
    'and the guide labelling the tunnel next to the blue GATE red is exactly right. ' +
    'That leaves the BASE ZONE: B2 is on the blue side under G402, so the guide and the ' +
    'manual really do disagree there, and the Competition Manual wins as the rules ' +
    'document. The guide also states the FIELD is symmetrical right to left, so if that ' +
    'reading is backwards the colours mirror and no distance, shape or rule changes.',
);

/**
 * Centre of a column, in inches from the field centre.
 *
 * A is the audience's right, which is +X in the world frame (`decodeField.ts`
 * documents why +X is right). So A is the most positive and F the most negative.
 */
export function columnCenterXIn(column: TileColumn): number {
  const index = COLUMNS.indexOf(column);
  if (index < 0) throw new Error(`Unknown TILE column "${column}".`);
  // Index 0 (A) is the +X edge, so the sign is inverted relative to the index.
  return (GRID / 2 - 0.5 - index) * TILE_IN;
}

/** Centre of a row, in inches. Row 1 is the audience side, so most negative. */
export function rowCenterYIn(row: TileRow): number {
  return (row - (GRID / 2 + 0.5)) * TILE_IN;
}

/** A vertical seam's X, in inches. `X` is the centre line at 0. */
export function verticalSeamXIn(seam: VerticalSeam): number {
  const index = VERTICAL_SEAMS.indexOf(seam);
  if (index < 0) throw new Error(`Unknown vertical TILE seam "${seam}".`);
  // Seam V sits between columns A and B, one half-tile inboard of A's centre.
  return columnCenterXIn(COLUMNS[index] as TileColumn) - TILE_IN / 2;
}

/** A horizontal seam's Y, in inches. Seam 3 is the centre line at 0. */
export function horizontalSeamYIn(seam: HorizontalSeam): number {
  return rowCenterYIn(seam as TileRow) + TILE_IN / 2;
}

export interface TileBounds {
  readonly minXIn: number;
  readonly maxXIn: number;
  readonly minYIn: number;
  readonly maxYIn: number;
}

/** The square a named TILE occupies. */
export function tileBounds(column: TileColumn, row: TileRow): TileBounds {
  const cx = columnCenterXIn(column);
  const cy = rowCenterYIn(row);
  const half = TILE_IN / 2;
  return { minXIn: cx - half, maxXIn: cx + half, minYIn: cy - half, maxYIn: cy + half };
}

/** Centre of a named TILE, in inches. */
export function tileCenterIn(column: TileColumn, row: TileRow): { xIn: number; yIn: number } {
  return { xIn: columnCenterXIn(column), yIn: rowCenterYIn(row) };
}

/**
 * The alliance a column belongs to, per G402.
 *
 * A-C are blue, D-F are red. Exposed because several elements are placed by
 * TILE and their alliance follows from the column rather than from a label.
 */
export function allianceOfColumn(column: TileColumn): 'red' | 'blue' {
  return COLUMNS.indexOf(column) < GRID / 2 ? 'blue' : 'red';
}
