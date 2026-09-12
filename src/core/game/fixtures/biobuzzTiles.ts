/**
 * BIOBUZZ's TILE coordinate system, and the world coordinates it maps to.
 *
 * Source: the **2026-2027 Event FIELD Setup Guide (V1.0)**, §6 "Tile
 * Coordinates", which publishes the grid as Figures 6-1 and 6-2 and then
 * addresses almost every taped element against it — "[1] Red (on tile A5) and
 * [1] Blue (on tile F2)", "[1] Red Garden (on Tile A1) and [1] Blue Garden (on
 * Tile F6)", "The width is set based on Tile Seam 1 and Tile Seam 5". That
 * turns positions this fixture previously had to guess (see
 * `BIOBUZZ_LAYOUT_PROVENANCE`) into transcriptions.
 *
 * ── The grid ───────────────────────────────────────────────────────────────
 *
 * 36 TILES, 6 x 6, each 24 in square: "In total there are [36] tiles placed in
 * a [6 by 6] grid" (§7.5) inside the 144 in interior. Columns are lettered A-F
 * and rows numbered 1-6. Seams are named too: vertical seams V, W, X, Y, Z
 * between the columns, horizontal seams 1-5 between the rows.
 *
 * ── Which way round ────────────────────────────────────────────────────────
 *
 * Figure 6-2 is a plan view labelled "Audience" along its bottom edge, with A
 * at its left and row 1 nearest the audience. The world frame puts the
 * audience at -Y and the audience's right at +X (`fieldTemplate.ts`; the same
 * reading `DECODE_FIELD_ORIENTATION` sets out), so:
 *
 *   - Column A is the audience's left: **-X**. F is +X.
 *   - Row 1 is the audience side: **-Y**. Row 6 is +Y.
 *
 * **This is the opposite lettering direction to DECODE.** DECODE's G402 puts
 * columns A-C on the blue side, which with red on the audience's left forces A
 * to +X (`decodeTiles.ts` sets out that derivation). BIOBUZZ letters the other
 * way: the guide puts the *red* LOADING ZONE on A5 and the *red* GARDEN on A1,
 * so A is red's side, and red is the audience's left. The two seasons simply
 * number their grids differently, which is exactly why each season owns its own
 * mapping rather than sharing one.
 *
 * The reading is self-checking: Figure 6-2 draws the HIVE frame across the four
 * centre TILES C3/C4/D3/D4, and those four are the only TILES whose shared
 * corner is the field centre under this mapping — matching §9.1, where the
 * frame is installed on the four centre tiles.
 */

import { explicitRule, type Sourced } from '../sourced.js';
import { FIELD_SIZE_IN } from './biobuzzDimensions.js';

/** Columns run A-F from the audience's left to their right. */
export type TileColumn = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
/** Rows run 1-6 from the audience side inward. */
export type TileRow = 1 | 2 | 3 | 4 | 5 | 6;

/** Vertical seams, between columns: V is A|B, X is C|D and the centre line. */
export type VerticalSeam = 'V' | 'W' | 'X' | 'Y' | 'Z';
/** Horizontal seams, between rows: 1 is row 1|2, 3 is the centre line. */
export type HorizontalSeam = 1 | 2 | 3 | 4 | 5;

const COLUMNS: readonly TileColumn[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const VERTICAL_SEAMS: readonly VerticalSeam[] = ['V', 'W', 'X', 'Y', 'Z'];

const GRID = 6;

/** One TILE is the interior divided by the grid: 144 / 6. */
export const TILE_SIDE_IN: Sourced<number> = explicitRule(
  FIELD_SIZE_IN / GRID,
  'Setup Guide S7.5',
  'In total there are [36] tiles placed in a [6 by 6] grid.',
  11,
);

export const BIOBUZZ_TILE_ORIENTATION: Sourced<string> = explicitRule(
  'columns A-F run left to right from the audience; rows 1-6 run away from it',
  'Setup Guide S6',
  'Figure 6-2 Tile locations, labelled A-F left to right and 1-6 bottom to top above the "Audience" edge.',
  8,
);

const TILE_IN = TILE_SIDE_IN.value;

/**
 * Centre of a column, in inches from the field centre.
 *
 * A is the audience's left, which is -X, so A is the most negative.
 */
export function columnCenterXIn(column: TileColumn): number {
  const index = COLUMNS.indexOf(column);
  if (index < 0) throw new Error(`Unknown TILE column "${column}".`);
  return (index - (GRID / 2 - 0.5)) * TILE_IN;
}

/** Centre of a row, in inches. Row 1 is the audience side, so most negative. */
export function rowCenterYIn(row: TileRow): number {
  return (row - (GRID / 2 + 0.5)) * TILE_IN;
}

/** A vertical seam's X, in inches. `X` is the centre line at 0. */
export function verticalSeamXIn(seam: VerticalSeam): number {
  const index = VERTICAL_SEAMS.indexOf(seam);
  if (index < 0) throw new Error(`Unknown vertical TILE seam "${seam}".`);
  // Seam V sits between columns A and B, one half-tile outboard of A's centre.
  return columnCenterXIn(COLUMNS[index] as TileColumn) + TILE_IN / 2;
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
