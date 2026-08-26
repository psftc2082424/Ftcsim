/**
 * The TILE grid, and the two checks that show it is oriented correctly.
 *
 * §9.4 defines TILE coordinates only in figures, which is why this fixture's
 * positions were guessed for so long. The Event FIELD Setup Guide places
 * elements against the same grid in text, so getting the mapping right is what
 * turns those instructions into coordinates — and getting it *wrong* would
 * silently mirror or transpose the whole field.
 */

import { describe, expect, it } from 'vitest';
import {
  DECODE_SETUP_GUIDE_COLOUR_CONFLICT,
  DECODE_TILE_ORIENTATION,
  allianceOfColumn,
  columnCenterXIn,
  horizontalSeamYIn,
  rowCenterYIn,
  tileBounds,
  tileCenterIn,
  verticalSeamXIn,
  type TileColumn,
} from './decodeTiles.js';
import { FIELD } from './decodeDimensions.js';

const HALF_FIELD_IN = FIELD.sideIn.value / 2;
const TILE_IN = FIELD.tileSideIn.value;
const COLUMNS: readonly TileColumn[] = ['A', 'B', 'C', 'D', 'E', 'F'];

describe('the grid covers the field exactly', () => {
  it('spans the field with six columns and six rows', () => {
    expect(columnCenterXIn('A') + TILE_IN / 2).toBeCloseTo(HALF_FIELD_IN, 9);
    expect(columnCenterXIn('F') - TILE_IN / 2).toBeCloseTo(-HALF_FIELD_IN, 9);
    expect(rowCenterYIn(1) - TILE_IN / 2).toBeCloseTo(-HALF_FIELD_IN, 9);
    expect(rowCenterYIn(6) + TILE_IN / 2).toBeCloseTo(HALF_FIELD_IN, 9);
  });

  it('spaces columns and rows one TILE apart', () => {
    for (let i = 1; i < COLUMNS.length; i++) {
      const previous = columnCenterXIn(COLUMNS[i - 1] as TileColumn);
      expect(columnCenterXIn(COLUMNS[i] as TileColumn)).toBeCloseTo(previous - TILE_IN, 9);
    }
    for (let row = 2; row <= 6; row++) {
      expect(rowCenterYIn(row as 2)).toBeCloseTo(rowCenterYIn((row - 1) as 1) + TILE_IN, 9);
    }
  });

  it('puts a seam halfway between the tiles it separates', () => {
    expect(verticalSeamXIn('V')).toBeCloseTo(
      (columnCenterXIn('A') + columnCenterXIn('B')) / 2,
      9,
    );
    expect(horizontalSeamYIn(1)).toBeCloseTo((rowCenterYIn(1) + rowCenterYIn(2)) / 2, 9);
  });
});

/**
 * The two coordinates the setup guide names outright. Both are load-bearing:
 * they are where it puts the apex of each LAUNCH LINE, and if the grid were
 * mirrored or transposed neither would land where the guide says.
 */
describe('the setup guide names two intersections, and both land where it says', () => {
  it('puts TILE intersection X3 at the field centre', () => {
    // "the center point of the FIELD, as defined by the [4] center TILES, at
    // the TILE intersection X3."
    expect(verticalSeamXIn('X')).toBeCloseTo(0, 9);
    expect(horizontalSeamYIn(3)).toBeCloseTo(0, 9);
  });

  it('puts TILE intersection X1 one TILE in from the audience', () => {
    // The front LAUNCH LINE is centred over X1, and §9.3 gives that zone a
    // depth of one TILE.
    expect(verticalSeamXIn('X')).toBeCloseTo(0, 9);
    expect(horizontalSeamYIn(1)).toBeCloseTo(-HALF_FIELD_IN + TILE_IN, 9);
  });
});

describe('orientation', () => {
  /**
   * §9.5 puts the red ALLIANCE AREA on the audience's left and G402 puts blue
   * in columns A-C. Both are true only if A is on the audience's right, which
   * in this world frame is +X.
   */
  it('runs the columns right to left from the audience', () => {
    expect(columnCenterXIn('A')).toBeGreaterThan(0);
    expect(columnCenterXIn('F')).toBeLessThan(0);
  });

  it('runs the rows away from the audience', () => {
    // Row 1 holds the front LAUNCH LINE and the LOADING ZONES, both of which
    // the guide places "on the audience side".
    expect(rowCenterYIn(1)).toBeLessThan(rowCenterYIn(6));
    expect(rowCenterYIn(1)).toBeLessThan(0);
  });

  it('assigns columns to alliances the way G402 does', () => {
    expect(allianceOfColumn('A')).toBe('blue');
    expect(allianceOfColumn('C')).toBe('blue');
    expect(allianceOfColumn('D')).toBe('red');
    expect(allianceOfColumn('F')).toBe('red');
  });

  it('puts red on the left from the audience, as §9.5 requires', () => {
    // Facing the field from the audience you look along +Y, so left is -X.
    const redColumns = COLUMNS.filter((c) => allianceOfColumn(c) === 'red');
    for (const column of redColumns) expect(columnCenterXIn(column)).toBeLessThan(0);
  });

  it('mirrors columns about the centre line', () => {
    expect(columnCenterXIn('A')).toBeCloseTo(-columnCenterXIn('F'), 9);
    expect(columnCenterXIn('B')).toBeCloseTo(-columnCenterXIn('E'), 9);
    expect(columnCenterXIn('C')).toBeCloseTo(-columnCenterXIn('D'), 9);
  });
});

describe('named tiles', () => {
  it('bounds a TILE by its own square', () => {
    const b2 = tileBounds('B', 2);
    expect(b2.maxXIn - b2.minXIn).toBeCloseTo(TILE_IN, 9);
    expect(b2.maxYIn - b2.minYIn).toBeCloseTo(TILE_IN, 9);
    expect(tileCenterIn('B', 2).xIn).toBeCloseTo((b2.minXIn + b2.maxXIn) / 2, 9);
  });

  /** The BASE ZONES stand on these, and they must mirror. */
  it('mirrors TILE B2 onto TILE E2', () => {
    expect(tileCenterIn('B', 2).xIn).toBeCloseTo(-tileCenterIn('E', 2).xIn, 9);
    expect(tileCenterIn('B', 2).yIn).toBeCloseTo(tileCenterIn('E', 2).yIn, 9);
  });

  it('rejects a column or seam it does not have', () => {
    expect(() => columnCenterXIn('G' as TileColumn)).toThrow(/column/);
    expect(() => verticalSeamXIn('Q' as 'V')).toThrow(/seam/);
  });
});

describe('provenance', () => {
  it('cites the rule that fixes the orientation', () => {
    expect(DECODE_TILE_ORIENTATION.confidence).toBe('explicit');
    expect(DECODE_TILE_ORIENTATION.sourceRule).toBe('G402');
    expect(DECODE_TILE_ORIENTATION.sourceQuote ?? '').toMatch(/columns A, B, C/);
  });

  /**
   * The setup guide contradicts the manual on which alliance owns the BASE and
   * SECRET TUNNEL. That has to stay visible: it is the one place this layout
   * knowingly picks a side.
   */
  it('records the colour conflict as an assumption', () => {
    expect(DECODE_SETUP_GUIDE_COLOUR_CONFLICT.confidence).toBe('assumed');
    expect(DECODE_SETUP_GUIDE_COLOUR_CONFLICT.note ?? '').toMatch(/symmetrical|mirror/i);
  });
});
