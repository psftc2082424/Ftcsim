/**
 * Bistable tipping structures, exercised on a made-up two-cell structure with
 * no season attached — proves the engine has no idea what a HIVE is.
 */

import { describe, expect, it } from 'vitest';
import { TippingStructures, resolveTippingRegions, type TippingStructureSpec, type TippingWorld } from './tipper.js';
import { createRectRegion } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';
import { explicit } from './sourced.js';

const DT = 1 / 200;

const CELL_A = createRectRegion({ id: 'cell-a', centerXIn: 0, centerYIn: 20, widthIn: 10, lengthIn: 10 });
const CELL_B = createRectRegion({ id: 'cell-b', centerXIn: 0, centerYIn: -20, widthIn: 10, lengthIn: 10 });

/** One "light" ball; the threshold below is two of them. */
const LIGHT_KG = 0.04;
const HEAVY_KG = LIGHT_KG * 2;

const SPEC: TippingStructureSpec = {
  id: 'seesaw',
  alliance: 'red',
  cellRegionIds: ['cell-a', 'cell-b'],
  initialUpIndex: 0,
  tipThresholdMassKg: explicit(LIGHT_KG * 2, undefined, 'test fixture'),
  cellRestHeightM: 1,
  cellHeightRateMps: 5,
  dumpSpeedMps: 0.5,
};

class FakeWorld implements TippingWorld {
  readonly guided = new Map<string, { accelerationMps2: Vec2; targetHeightM: number | undefined }>();
  readonly velocities = new Map<string, Vec2>();
  readonly completedTransfers: string[] = [];

  guidePiece(pieceId: string, accelerationMps2: Vec2, targetHeightM?: number): void {
    this.guided.set(pieceId, { accelerationMps2, targetHeightM });
  }

  setPieceVelocity(pieceId: string, velocityM: Vec2): void {
    this.velocities.set(pieceId, velocityM);
  }

  completePieceTransfer(pieceId: string): void {
    this.completedTransfers.push(pieceId);
  }
}

interface FakePiece {
  readonly at: Vec2;
  readonly massKg?: number;
  readonly transferring?: boolean;
}

function snapshot(piecesAt: ReadonlyMap<string, Vec2 | FakePiece>): WorldSnapshot {
  return {
    tick: 0,
    timeSec: 0,
    batteryVolts: 12,
    batteryCurrentA: 0,
    robots: [],
    pieces: [...piecesAt].map(([pieceId, value], index) => {
      const piece: FakePiece = 'at' in value ? value : { at: value };
      return {
        id: 100 + index,
        pieceId,
        pieceType: 'ball',
        pose: { p: piece.at, theta: 0 },
        previousPose: { p: piece.at, theta: 0 },
        vel: { v: vec2(0, 0), omega: 0 },
        radiusM: 0.05,
        massKg: piece.massKg ?? LIGHT_KG,
        heightM: 1,
        previousHeightM: 1,
        verticalVelocityMps: 0,
        airborne: false,
        ...(piece.transferring === undefined ? {} : { transferring: piece.transferring }),
        heldByRobotId: null,
      };
    }),
  };
}

const IN_CELL_A = vec2(0, 20 * 0.0254);
const IN_CELL_B = vec2(0, -20 * 0.0254);

describe('TippingStructures', () => {
  it('starts up on the declared cell', () => {
    const structures = new TippingStructures([SPEC]);
    expect(structures.currentUpRegionId('seesaw')).toBe('cell-a');
    expect(structures.tipCount('seesaw')).toBe(0);
  });

  it('holds resting pieces in the up cell at the declared height', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    structures.update(regions, snapshot(new Map([['a', IN_CELL_A]])), 1, DT, world);

    expect(world.guided.get('a')?.targetHeightM).toBe(1);
  });

  it('ignores pieces in the down cell', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    structures.update(regions, snapshot(new Map([['b', IN_CELL_B]])), 1, DT, world);

    expect(world.guided.has('b')).toBe(false);
  });

  it('tips once the up cell carries the threshold load, and flips which cell is up', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    const events = structures.update(
      regions,
      snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])),
      5,
      5 * DT,
      world,
    );

    expect(events).toEqual([
      { kind: 'StructureTipped', tick: 5, timeSec: 5 * DT, structureId: 'seesaw', alliance: 'red', upRegionId: 'cell-b' },
    ]);
    expect(structures.currentUpRegionId('seesaw')).toBe('cell-b');
    expect(structures.tipCount('seesaw')).toBe(1);
  });

  it('weighs the load rather than counting it, so one heavy piece tips what two light ones do', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    const events = structures.update(
      regions,
      snapshot(new Map([['heavy', { at: IN_CELL_A, massKg: HEAVY_KG }]])),
      5,
      5 * DT,
      world,
    );

    expect(events).toHaveLength(1);
    expect(structures.tipCount('seesaw')).toBe(1);
  });

  it('does not tip on a count alone when the pieces are too light to reach the threshold', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    const events = structures.update(
      regions,
      snapshot(
        new Map([
          ['a', { at: IN_CELL_A, massKg: LIGHT_KG / 2 }],
          ['b', { at: IN_CELL_A, massKg: LIGHT_KG / 2 }],
          ['c', { at: IN_CELL_A, massKg: LIGHT_KG / 2 }],
        ]),
      ),
      5,
      5 * DT,
      world,
    );

    expect(events).toEqual([]);
    expect(structures.tipCount('seesaw')).toBe(0);
  });

  it('ends the protected flight of a shot the cell has caught', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    structures.update(
      regions,
      snapshot(new Map([['shot', { at: IN_CELL_A, transferring: true }]])),
      1,
      DT,
      world,
    );

    // Without this the piece stays a non-colliding ghost for the rest of the
    // match: a game with no conveyor has nothing else that clears the flag.
    expect(world.completedTransfers).toEqual(['shot']);
  });

  it('leaves a piece that arrived normally alone rather than ending a transfer it never had', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    structures.update(regions, snapshot(new Map([['a', IN_CELL_A]])), 1, DT, world);

    expect(world.completedTransfers).toEqual([]);
  });

  it('dumps the pieces that were in the cell that just went down', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    structures.update(regions, snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])), 5, 5 * DT, world);

    expect(world.velocities.get('a')).toEqual(vec2(0.5, 0));
    expect(world.velocities.get('b')).toEqual(vec2(0.5, 0));
  });

  it('does not tip again on the very next tick just because a dumped piece has not moved yet', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    structures.update(regions, snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])), 5, 5 * DT, world);
    // Cell A is now the down cell; a piece still physically there this tick
    // (before it has actually moved away) must not count toward cell B tipping
    // again, and cell B is empty, so nothing should tip.
    const events = structures.update(
      regions,
      snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])),
      6,
      6 * DT,
      world,
    );
    expect(events).toEqual([]);
    expect(structures.currentUpRegionId('seesaw')).toBe('cell-b');
  });
});

describe('resolveTippingRegions', () => {
  it('throws when a structure names a region that does not exist', () => {
    expect(() => resolveTippingRegions([SPEC], [CELL_A])).toThrow(/cell-b/);
  });
});
