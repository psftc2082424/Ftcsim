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
  DECODE_FIELD_REGIONS,
  DECODE_FIELD_ZONES,
  DECODE_LAUNCH_ZONE_OUTLINES,
  DECODE_LAUNCH_ZONE_SHAPE,
  layoutFitsField,
} from './decodeField.js';
import { DECODE_REGIONS, DECODE_ZONES, spikeMarkIds } from './decode.js';
import { FIELD, LAUNCH_ZONES, ZONES } from './decodeDimensions.js';
import {
  horizontalSeamYIn,
  rowCenterYIn,
  tileBounds,
  verticalSeamXIn,
} from './decodeTiles.js';
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
  /**
   * The world frame is still read from several statements together, so it stays
   * `inferred`. The LAUNCH ZONE outline is not: the Event FIELD Setup Guide
   * describes the shape directly, and it landed exactly where the earlier
   * inference from §9.3 had put it.
   */
  it('marks the frame as inferred and the triangle layout as transcribed', () => {
    expect(DECODE_FIELD_ORIENTATION.confidence).toBe('inferred');
    expect(DECODE_FIELD_ORIENTATION.note).toMatch(/§9\.5/);

    expect(DECODE_LAUNCH_ZONE_SHAPE.confidence).toBe('explicit');
    expect(DECODE_LAUNCH_ZONE_SHAPE.sourceQuote ?? '').toMatch(/A6, B5, C4, D4, E5, and F6/);
  });
});

/**
 * Elements the Event FIELD Setup Guide places against the TILE grid.
 *
 * Each case restates the guide's instruction and checks the built geometry
 * against it. These were invented coordinates until the guide arrived, so what
 * they guard is that a transcription stayed a transcription.
 */
describe('element placement comes from the setup guide', () => {
  const shapeById = (id: string) => {
    const found =
      DECODE_FIELD_ZONES.find((z) => z.id === id) ?? DECODE_FIELD_REGIONS.find((r) => r.id === id);
    if (found === undefined) throw new Error(`no region or zone "${id}"`);
    return found;
  };

  const centreIn = (id: string): readonly [number, number] => {
    const { centerM } = shapeById(id);
    return [centerM.x / inchesToMeters(1), centerM.y / inchesToMeters(1)];
  };

  /**
   * "The red BASE ZONE is on TILE B2 and the blue is on TILE E2 ... lined up
   * with tape adjacent to the TILE seams W and 1" — an 18 in square in the
   * corner of its TILE. Colours follow G402's columns, not the guide's labels.
   */
  it('tucks each BASE ZONE into the corner of its TILE', () => {
    const blue = centreIn(DECODE_ZONES.blueBase);
    const red = centreIn(DECODE_ZONES.redBase);
    const half = ZONES.baseZoneSideIn.value / 2;

    // Hard against seam W and seam 1 respectively.
    expect(blue[0]).toBeCloseTo(verticalSeamXIn('W') + half, 6);
    expect(blue[1]).toBeCloseTo(horizontalSeamYIn(1) + half, 6);

    // And the mirror, since the guide says the field is symmetric left to right.
    expect(red[0]).toBeCloseTo(-blue[0], 6);
    expect(red[1]).toBeCloseTo(blue[1], 6);

    // Standing on the TILES the guide names.
    const b2 = tileBounds('B', 2);
    expect(blue[0]).toBeGreaterThan(b2.minXIn);
    expect(blue[0]).toBeLessThan(b2.maxXIn);
  });

  /**
   * "SPIKE MARKS are placed on TILE pairs A4/B4, A3/B3, and A2/B2, each
   * spanning TILE seam V ... along the centerline of a TILE."
   */
  it('straddles each SPIKE MARK across the seam on a row centreline', () => {
    for (const alliance of ['red', 'blue'] as const) {
      const seamX = alliance === 'blue' ? verticalSeamXIn('V') : verticalSeamXIn('Z');
      const ids = spikeMarkIds(alliance);
      expect(ids).toHaveLength(3);

      const ys = ids.map((id) => {
        const [x, y] = centreIn(id);
        expect(x).toBeCloseTo(seamX, 6);
        return y;
      });

      // Rows 2, 3 and 4: Near (audience), Middle, Far (GOAL side).
      expect(ys[0]).toBeCloseTo(rowCenterYIn(2), 6);
      expect(ys[1]).toBeCloseTo(rowCenterYIn(3), 6);
      expect(ys[2]).toBeCloseTo(rowCenterYIn(4), 6);
      // Read from the middle of the FIELD outward, so Near is nearest -Y.
      expect(ys[0]).toBeLessThan(ys[2] as number);
    }
  });

  it('mirrors the six SPIKE MARKS across the centre line', () => {
    for (let i = 0; i < 3; i++) {
      const blue = centreIn(spikeMarkIds('blue')[i] as string);
      const red = centreIn(spikeMarkIds('red')[i] as string);
      expect(red[0]).toBeCloseTo(-blue[0], 6);
      expect(red[1]).toBeCloseTo(blue[1], 6);
    }
  });

  /**
   * "their ends start at TILE seams V and Z and run toward the nearest
   * perimeter wall and parallel and adjacent to nearby TILE seam 3."
   */
  it('runs each GATE ZONE from its seam to the wall on seam 3', () => {
    const [x, y] = centreIn(DECODE_ZONES.blueGateZone);
    expect(y).toBeCloseTo(horizontalSeamYIn(3), 6);
    expect(x).toBeCloseTo(verticalSeamXIn('V') + ZONES.gateZoneLengthIn.value / 2, 6);
    // Toward the wall, not toward the centre.
    expect(x).toBeGreaterThan(verticalSeamXIn('V'));
  });

  /** "LOADING ZONES are in TILES A1 and F1, in the corners on the audience side." */
  it('anchors each LOADING ZONE in its audience-side corner', () => {
    const [x, y] = centreIn(DECODE_ZONES.blueLoadingZone);
    const half = ZONES.loadingZoneSideIn.value / 2;

    expect(x).toBeCloseTo(HALF_FIELD_IN - half, 6);
    expect(y).toBeCloseTo(-HALF_FIELD_IN + half, 6);
  });

  /**
   * "on TILES A2 and A3 spanning from TILE seam 1 to 3 ... 16.75 in. away from
   * the inside of TILE seam V."
   */
  it('offsets each SECRET TUNNEL from its seam and spans seams 1 to 3', () => {
    const [x, y] = centreIn(DECODE_ZONES.redSecretTunnel);

    expect(x - ZONES.secretTunnelWidthIn.value / 2).toBeCloseTo(verticalSeamXIn('V') + 16.75, 6);
    expect(y).toBeCloseTo((horizontalSeamYIn(1) + horizontalSeamYIn(3)) / 2, 6);
  });

  /**
   * The pairing §9.8.3 states, as geometry: a GATE releases into the *opposing*
   * ALLIANCE'S SECRET TUNNEL, and G424.A puts a ROBOT in its own GATE ZONE and
   * its opponent's SECRET TUNNEL at once — so the two must be neighbours. This
   * is what settles the setup guide's colour labels for the tunnels.
   */
  it('puts each GATE ZONE beside the opposing SECRET TUNNEL, not its own', () => {
    for (const alliance of ['red', 'blue'] as const) {
      const gate = centreIn(
        alliance === 'red' ? DECODE_ZONES.redGateZone : DECODE_ZONES.blueGateZone,
      );
      const own = centreIn(
        alliance === 'red' ? DECODE_ZONES.redSecretTunnel : DECODE_ZONES.blueSecretTunnel,
      );
      const opponent = centreIn(
        alliance === 'red' ? DECODE_ZONES.blueSecretTunnel : DECODE_ZONES.redSecretTunnel,
      );

      const near = Math.hypot(gate[0] - opponent[0], gate[1] - opponent[1]);
      const far = Math.hypot(gate[0] - own[0], gate[1] - own[1]);

      expect(near, alliance).toBeLessThan(far);
      // Adjacent, not merely nearer: they share the seam-3 boundary.
      expect(near, alliance).toBeLessThan(ZONES.secretTunnelLengthIn.value);
    }
  });

  /** Everything stays on the field, including the elements added here. */
  it('keeps every element inside the perimeter', () => {
    expect(layoutFitsField()).toBe(true);

    for (const shaped of [...DECODE_FIELD_REGIONS, ...DECODE_FIELD_ZONES]) {
      if (shaped.shape.kind === 'circle') continue;
      for (const vertex of shaped.shape.vertices) {
        expect(Math.abs(vertex.x)).toBeLessThanOrEqual(inchesToMeters(HALF_FIELD_IN) + 1e-9);
        expect(Math.abs(vertex.y)).toBeLessThanOrEqual(inchesToMeters(HALF_FIELD_IN) + 1e-9);
      }
    }
  });

  /** The DEPOT is tape in front of the GOAL, not underneath the RAMP. */
  it('keeps the DEPOT clear of the RAMP', () => {
    const depot = shapeById(DECODE_REGIONS.redDepot);
    const ramp = shapeById(DECODE_REGIONS.redRamp);
    if (depot.shape.kind === 'circle' || ramp.shape.kind === 'circle') return;

    const overlaps = depot.shape.vertices.some((v) =>
      shapeContainsPoint(ramp.shape, ramp.centerM, v),
    );
    expect(overlaps).toBe(false);
  });

  /**
   * Regression: the GOAL/RAMP/DEPOT cluster and its own GATE ZONE used to be
   * placed with opposite sign conventions (`GOAL_CLUSTER_SIDE` disagreed with
   * `SIDE`), so an alliance's own classifier queue and the GATE that opens it
   * sat in opposite corners of the field — a shot would score, but a driver
   * standing where the manual puts the GATE would never open it. The GOAL,
   * RAMP, GATE and the alliance's own half must all fall on the same side.
   */
  it('keeps a GOAL, its RAMP, its GATE and its own half on the same side', () => {
    for (const alliance of ['red', 'blue'] as const) {
      const sideX = centreIn(alliance === 'red' ? DECODE_ZONES.redSide : DECODE_ZONES.blueSide)[0];
      const goalX = centreIn(
        alliance === 'red' ? DECODE_REGIONS.redGoal : DECODE_REGIONS.blueGoal,
      )[0];
      const rampX = centreIn(
        alliance === 'red' ? DECODE_REGIONS.redRamp : DECODE_REGIONS.blueRamp,
      )[0];
      const gateX = centreIn(
        alliance === 'red' ? DECODE_ZONES.redGateZone : DECODE_ZONES.blueGateZone,
      )[0];

      expect(Math.sign(goalX), `${alliance} goal vs side`).toBe(Math.sign(sideX));
      expect(Math.sign(rampX), `${alliance} ramp vs side`).toBe(Math.sign(sideX));
      expect(Math.sign(gateX), `${alliance} gate vs side`).toBe(Math.sign(sideX));
    }
  });

  /**
   * The GATE marks the boundary between an alliance's own RAMP (goal side of
   * the centreline) and the CLASSIFIER's low end (at the centreline) — they
   * have to be close together lengthwise, not just on the same half.
   */
  it('puts each GATE at the near end of its own RAMP', () => {
    for (const alliance of ['red', 'blue'] as const) {
      const gate = centreIn(alliance === 'red' ? DECODE_ZONES.redGateZone : DECODE_ZONES.blueGateZone);
      const ramp = shapeById(alliance === 'red' ? DECODE_REGIONS.redRamp : DECODE_REGIONS.blueRamp);
      if (ramp.shape.kind === 'circle') continue;

      const rampMinY = Math.min(...ramp.shape.vertices.map((v) => v.y)) / inchesToMeters(1);
      // Within a couple of ARTIFACT diameters of the RAMP's low end, not
      // merely "somewhere on the correct half of a 144 in field".
      expect(Math.abs(gate[1] - rampMinY), alliance).toBeLessThan(20);
    }
  });
});
