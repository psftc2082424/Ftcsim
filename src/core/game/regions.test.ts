import { describe, expect, it } from 'vitest';
import {
  createCircleRegion,
  createPolyRegion,
  createRectRegion,
  createRectZone,
  missingRegionIds,
  regionContains,
  regionsContaining,
  robotFullyInZone,
  robotSupportFraction,
  shapeContainsPoint,
  spanContainsHeight,
  validateRegions,
} from './regions.js';
import { vec2 } from '../math/vec2.js';
import { createObb } from '../physics/shapes.js';
import { inchesToMeters } from '../units/convert.js';

/** Authoring is in inches; membership queries are in metres. */
const at = (xIn: number, yIn: number) => vec2(inchesToMeters(xIn), inchesToMeters(yIn));

const goal = createRectRegion({
  id: 'red-goal',
  centerXIn: 24,
  centerYIn: 0,
  widthIn: 12,
  lengthIn: 12,
});

describe('authoring converts inches to SI once', () => {
  it('places a region at the metric equivalent of its inch centre', () => {
    expect(goal.centerM.x).toBeCloseTo(inchesToMeters(24), 12);
    expect(goal.centerM.y).toBeCloseTo(0, 12);
  });

  it('sizes a rectangle from its inch dimensions', () => {
    // 12 in wide centred at 24 in spans 18–30 in.
    expect(regionContains(goal, at(18.1, 0))).toBe(true);
    expect(regionContains(goal, at(29.9, 0))).toBe(true);
    expect(regionContains(goal, at(17.9, 0))).toBe(false);
    expect(regionContains(goal, at(30.1, 0))).toBe(false);
  });

  it('sizes a circle from its inch radius', () => {
    const spot = createCircleRegion({ id: 'spot', centerXIn: 0, centerYIn: 0, radiusIn: 6 });
    expect(regionContains(spot, at(5.9, 0))).toBe(true);
    expect(regionContains(spot, at(6.1, 0))).toBe(false);
    // Diagonally the radius is reached at 6/sqrt(2) = 4.243 in on each axis, so
    // 4.2 is inside and 4.3 (6.08 in from centre) is already outside.
    expect(regionContains(spot, at(4.2, 4.2))).toBe(true);
    expect(regionContains(spot, at(4.3, 4.3))).toBe(false);
    expect(regionContains(spot, at(5, 5))).toBe(false);
  });
});

describe('convex membership', () => {
  it('accepts a point on the boundary', () => {
    // A piece resting exactly on a line must not score or not score on a
    // floating-point coin flip.
    expect(regionContains(goal, at(18, 0))).toBe(true);
    expect(regionContains(goal, at(24, 6))).toBe(true);
  });

  it('rejects points outside on every side', () => {
    for (const [x, y] of [
      [24, 7],
      [24, -7],
      [31, 0],
      [17, 0],
    ] as const) {
      expect(regionContains(goal, at(x, y)), `(${x}, ${y})`).toBe(false);
    }
  });

  it('handles a non-rectangular convex polygon', () => {
    // A counter-clockwise triangle.
    const wedge = createPolyRegion('wedge', [vec2(0, 0), vec2(12, 0), vec2(0, 12)]);
    expect(regionContains(wedge, at(1, 1))).toBe(true);
    expect(regionContains(wedge, at(5, 5))).toBe(true);
    // Outside the hypotenuse.
    expect(regionContains(wedge, at(9, 9))).toBe(false);
    expect(regionContains(wedge, at(-1, 1))).toBe(false);
  });

  it('works directly on a shape and centre', () => {
    expect(shapeContainsPoint(goal.shape, goal.centerM, at(24, 0))).toBe(true);
    expect(shapeContainsPoint(goal.shape, goal.centerM, at(40, 0))).toBe(false);
  });
});

describe('vertical spans', () => {
  const raised = createRectRegion({
    id: 'high-goal',
    centerXIn: 0,
    centerYIn: 0,
    widthIn: 12,
    lengthIn: 12,
    bottomIn: 30,
    topIn: 42,
  });

  /** A piece rolling underneath a raised goal has not scored in it. */
  it('excludes a piece below the band', () => {
    expect(regionContains(raised, at(0, 0), inchesToMeters(0))).toBe(false);
    expect(regionContains(raised, at(0, 0), inchesToMeters(29))).toBe(false);
  });

  it('includes a piece within the band', () => {
    expect(regionContains(raised, at(0, 0), inchesToMeters(36))).toBe(true);
    expect(regionContains(raised, at(0, 0), inchesToMeters(30))).toBe(true);
    expect(regionContains(raised, at(0, 0), inchesToMeters(42))).toBe(true);
  });

  it('excludes a piece above the band', () => {
    expect(regionContains(raised, at(0, 0), inchesToMeters(43))).toBe(false);
  });

  it('treats an absent span as floor to ceiling', () => {
    expect(spanContainsHeight(undefined, 0)).toBe(true);
    expect(spanContainsHeight(undefined, 1000)).toBe(true);
    expect(regionContains(goal, at(24, 0), 5)).toBe(true);
  });

  it('defaults an open-topped band to unbounded above', () => {
    const openTop = createRectRegion({
      id: 'open',
      centerXIn: 0,
      centerYIn: 0,
      widthIn: 12,
      lengthIn: 12,
      bottomIn: 10,
    });
    expect(regionContains(openTop, at(0, 0), inchesToMeters(9))).toBe(false);
    expect(regionContains(openTop, at(0, 0), inchesToMeters(1000))).toBe(true);
  });
});

describe('regionsContaining', () => {
  const outer = createRectRegion({
    id: 'outer',
    centerXIn: 0,
    centerYIn: 0,
    widthIn: 48,
    lengthIn: 48,
  });
  const inner = createRectRegion({
    id: 'inner',
    centerXIn: 0,
    centerYIn: 0,
    widthIn: 12,
    lengthIn: 12,
  });

  it('reports every containing region', () => {
    expect(regionsContaining([outer, inner], at(0, 0))).toEqual(['outer', 'inner']);
  });

  it('preserves the order the regions were given', () => {
    // The definition decides nesting order; this function must not re-sort.
    expect(regionsContaining([inner, outer], at(0, 0))).toEqual(['inner', 'outer']);
  });

  it('reports only the outer region outside the inner one', () => {
    expect(regionsContaining([outer, inner], at(20, 0))).toEqual(['outer']);
  });

  it('reports nothing outside everything', () => {
    expect(regionsContaining([outer, inner], at(100, 100))).toEqual([]);
  });

  it('respects vertical spans when filtering', () => {
    const raised = createRectRegion({
      id: 'raised',
      centerXIn: 0,
      centerYIn: 0,
      widthIn: 48,
      lengthIn: 48,
      bottomIn: 20,
    });
    expect(regionsContaining([outer, raised], at(0, 0), 0)).toEqual(['outer']);
    expect(regionsContaining([outer, raised], at(0, 0), inchesToMeters(30))).toEqual([
      'outer',
      'raised',
    ]);
  });
});

describe('robot zone occupancy', () => {
  // DECODE's BASE ZONE is an 18 in square (§9.3); an 18 in robot only fits
  // exactly, so a 36 in zone gives room to test partial overlap.
  const base = createRectZone({
    id: 'red-base',
    centerXIn: 0,
    centerYIn: 0,
    widthIn: 36,
    lengthIn: 36,
  });
  const robot = createObb(inchesToMeters(18), inchesToMeters(18));

  it('reports full support when the robot is entirely inside', () => {
    expect(robotSupportFraction(base, robot, at(0, 0), 0)).toBe(1);
    expect(robotFullyInZone(base, robot, at(0, 0), 0)).toBe(true);
  });

  it('reports no support when the robot is entirely outside', () => {
    expect(robotSupportFraction(base, robot, at(60, 0), 0)).toBe(0);
    expect(robotFullyInZone(base, robot, at(60, 0), 0)).toBe(false);
  });

  it('reports partial support when the robot straddles an edge', () => {
    // Zone spans -18..18 in; a robot centred at 18 in has half its corners in.
    const fraction = robotSupportFraction(base, robot, at(18, 0), 0);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
    expect(fraction).toBeCloseTo(0.5, 9);
  });

  it('accounts for heading', () => {
    // Rotated 45 degrees, an 18 in robot reaches 12.7 in from centre rather than
    // 9 in, so a position that fits square does not fit turned.
    const corner = at(9, 9);
    expect(robotFullyInZone(base, robot, corner, 0)).toBe(true);
    expect(robotFullyInZone(base, robot, corner, Math.PI / 4)).toBe(false);
  });

  it('is exact at both endpoints, which is what games actually ask', () => {
    for (const heading of [0, 0.3, Math.PI / 4, 1.1]) {
      expect(robotFullyInZone(base, robot, at(0, 0), heading)).toBe(true);
      expect(robotSupportFraction(base, robot, at(200, 200), heading)).toBe(0);
    }
  });

  /**
   * The documented limitation of corner sampling (ASSUMPTIONS.md §10.6): a zone
   * small enough to sit entirely inside the robot's footprint touches no corner
   * and reads as zero overlap.
   */
  it('under-reports a zone smaller than the robot', () => {
    const tiny = createRectZone({
      id: 'tiny',
      centerXIn: 0,
      centerYIn: 0,
      widthIn: 4,
      lengthIn: 4,
    });
    expect(robotSupportFraction(tiny, robot, at(0, 0), 0)).toBe(0);
  });
});

describe('region set validation', () => {
  it('accepts a well-formed set', () => {
    expect(validateRegions([goal])).toEqual([]);
  });

  it('catches a duplicate id', () => {
    const problems = validateRegions([goal, goal]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(/Duplicate region id/);
  });

  it('catches an inverted vertical span', () => {
    const inverted = createRectRegion({
      id: 'inverted',
      centerXIn: 0,
      centerYIn: 0,
      widthIn: 12,
      lengthIn: 12,
      bottomIn: 40,
      topIn: 10,
    });
    expect(validateRegions([inverted])[0]?.message).toMatch(/inverted/);
  });

  it('catches a nonsensical slot count', () => {
    const bad = createRectRegion({
      id: 'ramp',
      centerXIn: 0,
      centerYIn: 0,
      widthIn: 12,
      lengthIn: 12,
      slotCount: 0,
    });
    expect(validateRegions([bad])[0]?.message).toMatch(/slotCount/);
  });

  it('accepts a valid slot count', () => {
    const ramp = createRectRegion({
      id: 'ramp',
      centerXIn: 0,
      centerYIn: 0,
      widthIn: 12,
      lengthIn: 60,
      slotCount: 9,
    });
    expect(validateRegions([ramp])).toEqual([]);
    expect(ramp.slotCount).toBe(9);
  });
});

describe('cross-checking regions against the ids rules reference', () => {
  /**
   * The gap this module exists to close: a rule set naming regions that no
   * geometry provides would score nothing and say nothing about why.
   */
  it('reports referenced ids that have no geometry', () => {
    expect(missingRegionIds([goal], ['red-goal', 'blue-goal', 'red-depot'])).toEqual([
      'blue-goal',
      'red-depot',
    ]);
  });

  it('reports nothing when every id is provided', () => {
    expect(missingRegionIds([goal], ['red-goal'])).toEqual([]);
  });

  it('deduplicates repeated references', () => {
    expect(missingRegionIds([], ['ghost', 'ghost'])).toEqual(['ghost']);
  });
});
