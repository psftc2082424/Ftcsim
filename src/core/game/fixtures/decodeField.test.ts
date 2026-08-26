/**
 * The DECODE geometry that comes from the manual rather than from a guess.
 *
 * These assert the *derivation*, not the numbers: each one restates a figure
 * the Competition Manual publishes and checks the built geometry against it. If
 * someone later replaces the placeholder positions with CAD coordinates, the
 * LAUNCH ZONES and alliance halves must still satisfy every case below, because
 * the manual has not changed.
 */

import { describe, expect, it } from 'vitest';
import {
  DECODE_FIELD_ORIENTATION,
  DECODE_FIELD_ZONES,
  DECODE_LAUNCH_ZONE_OUTLINES,
  DECODE_LAUNCH_ZONE_SHAPE,
  layoutFitsField,
} from './decodeField.js';
import { DECODE_ZONES } from './decode.js';
import { FIELD, LAUNCH_ZONES } from './decodeDimensions.js';
import { robotSupportFraction, shapeContainsPoint, type FieldZone } from '../regions.js';
import { createObb } from '../../physics/shapes.js';
import { inchesToMeters } from '../../units/convert.js';
import { vec2, type Vec2 } from '../../math/vec2.js';

const HALF_FIELD_IN = FIELD.sideIn.value / 2;
const TILE_IN = FIELD.tileSideIn.value;

const zoneById = (id: string): FieldZone => {
  const zone = DECODE_FIELD_ZONES.find((z) => z.id === id);
  if (zone === undefined) throw new Error(`no zone ${id}`);
  return zone;
};

/** Zone membership for a point given in inches. */
const containsPointIn = (zone: FieldZone, xIn: number, yIn: number): boolean =>
  shapeContainsPoint(zone.shape, zone.centerM, vec2(inchesToMeters(xIn), inchesToMeters(yIn)));

/** Support fraction for an 18 in robot, square to the field, placed in inches. */
const supportOf = (zone: FieldZone, xIn: number, yIn: number): number =>
  robotSupportFraction(
    zone,
    createObb(inchesToMeters(18), inchesToMeters(18)),
    vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
    0,
  );

/** Outlines are authored in inches; `createPolyZone` converts on the way in. */
const spanOf = (vertices: readonly Vec2[], axis: 'x' | 'y'): { min: number; max: number } => {
  const values = vertices.map((v) => v[axis]);
  return { min: Math.min(...values), max: Math.max(...values) };
};

describe('LAUNCH ZONES are built from §9.3, not invented', () => {
  it('has exactly two, and neither belongs to an alliance', () => {
    const launchZones = DECODE_FIELD_ZONES.filter((z) => z.id.includes('launch'));

    expect(launchZones).toHaveLength(2);
    for (const zone of launchZones) {
      expect(zone.id).not.toMatch(/^(red|blue)-/);
    }
  });

  it('is triangular, as the manual describes', () => {
    for (const outline of Object.values(DECODE_LAUNCH_ZONE_OUTLINES)) {
      expect(outline).toHaveLength(3);
    }
  });

  /**
   * "the LAUNCH ZONE on the GOAL side of the FIELD spans a section 6 TILES wide
   *  by 3 TILES deep" — six TILES is 144 in, the entire field width, so this
   * zone's base is the whole GOAL-side wall.
   */
  it('spans the whole GOAL-side wall and three TILES inward', () => {
    const outline = DECODE_LAUNCH_ZONE_OUTLINES.goalSide;
    const x = spanOf(outline, 'x');
    const y = spanOf(outline, 'y');

    expect(x.max - x.min).toBeCloseTo(LAUNCH_ZONES.goalSideWidthTiles.value * TILE_IN, 6);
    expect(x.max - x.min).toBeCloseTo(FIELD.sideIn.value, 6);
    expect(y.max).toBeCloseTo(HALF_FIELD_IN, 6);
    expect(y.max - y.min).toBeCloseTo(LAUNCH_ZONES.goalSideDepthTiles.value * TILE_IN, 6);
  });

  /** "2 TILES wide and 1 TILE deep", on the audience side. */
  it('spans two TILES of the audience wall and one TILE inward', () => {
    const outline = DECODE_LAUNCH_ZONE_OUTLINES.audience;
    const x = spanOf(outline, 'x');
    const y = spanOf(outline, 'y');

    expect(x.max - x.min).toBeCloseTo(LAUNCH_ZONES.audienceWidthTiles.value * TILE_IN, 6);
    expect(y.min).toBeCloseTo(-HALF_FIELD_IN, 6);
    expect(y.max - y.min).toBeCloseTo(LAUNCH_ZONES.audienceDepthTiles.value * TILE_IN, 6);
  });

  /** Neither belongs to an alliance, so both are symmetric about the divide. */
  it('places both symmetrically about the alliance divide', () => {
    for (const outline of Object.values(DECODE_LAUNCH_ZONE_OUTLINES)) {
      const x = spanOf(outline, 'x');
      expect(x.min + x.max).toBeCloseTo(0, 6);
    }
  });

  it('keeps every vertex inside the field perimeter', () => {
    expect(layoutFitsField()).toBe(true);
  });
});

describe('LAUNCH ZONE membership', () => {
  const goalSide = zoneById(DECODE_ZONES.goalLaunchZone);
  const audience = zoneById(DECODE_ZONES.audienceLaunchZone);

  /**
   * The GOAL-side triangle has its apex at the field centre, so its boundary is
   * `y = |x|` and a point is inside when `y >= |x|`. Checking the diagonal is
   * what distinguishes a triangle from the bounding box a rectangle would use.
   */
  it('excludes the corners the bounding box would have included', () => {
    // Deep in the zone, near the wall and near the centre line.
    expect(containsPointIn(goalSide, 0, 60)).toBe(true);
    expect(containsPointIn(goalSide, -60, 65)).toBe(true);

    // Same y band, but out past the diagonal — inside a 6x3 rectangle, outside
    // the triangle the manual describes.
    expect(containsPointIn(goalSide, -70, 20)).toBe(false);
    expect(containsPointIn(goalSide, 70, 20)).toBe(false);
  });

  it('puts the apex of the GOAL-side zone at the field centre', () => {
    expect(containsPointIn(goalSide, 0, 0)).toBe(true);
    expect(containsPointIn(goalSide, 0, -1)).toBe(false);
  });

  it('keeps the audience zone against its own wall', () => {
    expect(containsPointIn(audience, 0, -60)).toBe(true);
    // Beyond one TILE of depth.
    expect(containsPointIn(audience, 0, -40)).toBe(false);
    // Beyond one TILE either side of centre.
    expect(containsPointIn(audience, 30, -70)).toBe(false);
  });

  /**
   * G304 requires a starting ROBOT to be over a LAUNCH LINE, touching the
   * perimeter, and fully on its own side. The fixture's start position has to
   * satisfy all three or the LEAVE cases assert nothing.
   */
  it('accepts a legal G304 starting position for each alliance', () => {
    for (const x of [-30, 30]) {
      expect(supportOf(goalSide, x, 63)).toBe(1);
      // Touching the GOAL-side perimeter: 63 + half of an 18 in robot = 72.
      expect(63 + 9).toBeCloseTo(HALF_FIELD_IN, 6);
      // Fully on its own side of the centre line.
      expect(Math.abs(x) - 9).toBeGreaterThan(0);
    }
  });

  it('reports a robot clear of both zones as clear', () => {
    for (const zone of [goalSide, audience]) {
      expect(supportOf(zone, -20, -20)).toBe(0);
      expect(supportOf(zone, 20, -20)).toBe(0);
    }
  });

  /** Partial support still counts as "over" a LAUNCH LINE for LEAVE (§10.5.3). */
  it('reports partial support for a robot straddling the boundary', () => {
    const fraction = supportOf(goalSide, -30, 33);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
  });
});

describe('alliance halves come from G402', () => {
  const red = zoneById(DECODE_ZONES.redSide);
  const blue = zoneById(DECODE_ZONES.blueSide);

  /** "columns A, B, C ... blue ... columns D, E, F ... red" — three TILES each. */
  it('splits the field into three TILES per alliance at the centre line', () => {
    expect(containsPointIn(red, -70, 0)).toBe(true);
    expect(containsPointIn(red, -1, 0)).toBe(true);
    expect(containsPointIn(red, 1, 0)).toBe(false);

    expect(containsPointIn(blue, 70, 0)).toBe(true);
    expect(containsPointIn(blue, 1, 0)).toBe(true);
    expect(containsPointIn(blue, -1, 0)).toBe(false);
  });

  it('measures three TILES wide, the whole depth of the field', () => {
    for (const [zone, sign] of [
      [red, -1],
      [blue, 1],
    ] as const) {
      expect(containsPointIn(zone, sign * (3 * TILE_IN - 1), 70)).toBe(true);
      expect(containsPointIn(zone, sign * (3 * TILE_IN - 1), -70)).toBe(true);
    }
  });

  /** G402.A asks whether an opponent is *completely* within its own side. */
  it('answers whether a robot is completely within one side', () => {
    expect(supportOf(red, -30, 0)).toBe(1);
    // Straddling the centre line is not "completely within".
    expect(supportOf(red, -4, 0)).toBeLessThan(1);
    expect(supportOf(red, -4, 0)).toBeGreaterThan(0);
  });
});

describe('provenance of the derived geometry', () => {
  it('marks the frame and the triangle layout as inferred, not stated', () => {
    expect(DECODE_FIELD_ORIENTATION.confidence).toBe('inferred');
    expect(DECODE_LAUNCH_ZONE_SHAPE.confidence).toBe('inferred');
    expect(DECODE_FIELD_ORIENTATION.note).toMatch(/§9\.5/);
    expect(DECODE_LAUNCH_ZONE_SHAPE.sourcePage).toBe(62);
  });
});
