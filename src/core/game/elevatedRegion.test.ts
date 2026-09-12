/**
 * Elevated regions, exercised on a made-up region with no season attached.
 */

import { describe, expect, it } from 'vitest';
import { ElevatedRegions, resolveElevatedRegions, type ElevatedRegionSpec, type ElevatedRegionWorld } from './elevatedRegion.js';
import { createRectRegion } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

const POCKET = createRectRegion({ id: 'pocket', centerXIn: 0, centerYIn: 0, widthIn: 10, lengthIn: 10, bottomIn: 10, topIn: 20 });

const SPEC: ElevatedRegionSpec = { id: 'pocket-hold', regionId: 'pocket', restHeightM: 0.4, heightRateMps: 5 };

class FakeWorld implements ElevatedRegionWorld {
  readonly guided = new Map<string, { targetHeightM?: number }>();
  guidePiece(pieceId: string, _accelerationMps2: Vec2, targetHeightM?: number): void {
    this.guided.set(pieceId, { targetHeightM });
  }
}

function snapshot(pieces: ReadonlyMap<string, { p: Vec2; heightM: number }>): WorldSnapshot {
  return {
    tick: 0,
    timeSec: 0,
    batteryVolts: 12,
    batteryCurrentA: 0,
    robots: [],
    pieces: [...pieces].map(([pieceId, { p, heightM }], index) => ({
      id: 100 + index,
      pieceId,
      pieceType: 'ball',
      pose: { p, theta: 0 },
      previousPose: { p, theta: 0 },
      vel: { v: vec2(0, 0), omega: 0 },
      radiusM: 0.05,
      heightM,
      previousHeightM: heightM,
      verticalVelocityMps: 0,
      airborne: false,
      heldByRobotId: null,
    })),
  };
}

describe('ElevatedRegions', () => {
  it('holds a piece already within the region at its declared height', () => {
    const regions = new ElevatedRegions([SPEC]);
    const places = resolveElevatedRegions([SPEC], [POCKET]);
    const world = new FakeWorld();

    regions.update(places, snapshot(new Map([['a', { p: vec2(0, 0), heightM: 0.4 }]])), world);

    expect(world.guided.get('a')?.targetHeightM).toBe(0.4);
  });

  it('ignores a piece below the region\'s height band', () => {
    const regions = new ElevatedRegions([SPEC]);
    const places = resolveElevatedRegions([SPEC], [POCKET]);
    const world = new FakeWorld();

    // Floor height (0.05 m) is well below the region's 10-20 in band.
    regions.update(places, snapshot(new Map([['a', { p: vec2(0, 0), heightM: 0.05 }]])), world);

    expect(world.guided.has('a')).toBe(false);
  });

  it('ignores a piece outside the region horizontally, even at the right height', () => {
    const regions = new ElevatedRegions([SPEC]);
    const places = resolveElevatedRegions([SPEC], [POCKET]);
    const world = new FakeWorld();

    regions.update(places, snapshot(new Map([['a', { p: vec2(1, 1), heightM: 0.4 }]])), world);

    expect(world.guided.has('a')).toBe(false);
  });
});

describe('resolveElevatedRegions', () => {
  it('throws when a spec names a region that does not exist', () => {
    expect(() => resolveElevatedRegions([SPEC], [])).toThrow(/pocket/);
  });
});
