/**
 * Bistable tipping structures, exercised on a made-up two-cell structure with
 * no season attached — proves the engine has no idea what a HIVE is.
 */

import { describe, expect, it } from 'vitest';
import {
  TippingStructures,
  resolveTippingRegions,
  tipDurationSec,
  type TippingStructureSpec,
  type TippingWorld,
} from './tipper.js';
import { createRectRegion, type FieldRegion } from './regions.js';
import type { StructureTippedEvent } from './events.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import { Pcg32, type SubStreamId } from '../math/rng.js';
import type { WorldSnapshot } from '../sim/snapshot.js';
import { explicit } from './sourced.js';

const DT = 1 / 200;

const CELL_A = createRectRegion({ id: 'cell-a', centerXIn: 0, centerYIn: 20, widthIn: 10, lengthIn: 10 });
const CELL_B = createRectRegion({ id: 'cell-b', centerXIn: 0, centerYIn: -20, widthIn: 10, lengthIn: 10 });

/** One "light" ball; the threshold below is two of them. */
const LIGHT_KG = 0.04;
const HEAVY_KG = LIGHT_KG * 2;

/** A whole second of swing, so a tick-counted test reads in round numbers. */
const SWING_SEC = 1;

const SPEC: TippingStructureSpec = {
  id: 'seesaw',
  alliance: 'red',
  cellRegionIds: ['cell-a', 'cell-b'],
  initialUpIndex: 0,
  tipThresholdMassKg: explicit(LIGHT_KG * 2, undefined, 'test fixture'),
  tipDurationAtThresholdSec: explicit(SWING_SEC, undefined, 'test fixture'),
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

  rng(stream: SubStreamId): Pcg32 {
    return new Pcg32(1, stream);
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

/**
 * Feed one unchanging snapshot in for `ticks` ticks, reporting the tick a tip
 * actually completed on. A tip is a timed swing now, so almost every
 * expectation below is about *when* it lands, not merely that it did.
 */
function run(
  structures: TippingStructures,
  regions: ReadonlyMap<string, FieldRegion>,
  snap: WorldSnapshot,
  world: FakeWorld,
  ticks: number,
): { events: StructureTippedEvent[]; tipTick: number | null } {
  const events: StructureTippedEvent[] = [];
  let tipTick: number | null = null;
  for (let tick = 1; tick <= ticks; tick++) {
    const produced = structures.update(regions, snap, tick, tick * DT, world);
    if (produced.length > 0 && tipTick === null) tipTick = tick;
    events.push(...produced);
  }
  return { events, tipTick };
}

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

    const { events, tipTick } = run(
      structures,
      regions,
      snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])),
      world,
      400,
    );

    expect(tipTick).not.toBeNull();
    expect(events).toEqual([
      {
        kind: 'StructureTipped',
        tick: tipTick,
        timeSec: (tipTick as number) * DT,
        structureId: 'seesaw',
        alliance: 'red',
        upRegionId: 'cell-b',
      },
    ]);
    expect(structures.currentUpRegionId('seesaw')).toBe('cell-b');
    expect(structures.tipCount('seesaw')).toBe(1);
  });

  it('takes the declared swing time to come over rather than flipping on the loading tick', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();
    const loaded = snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]]));

    // The load is already there on tick 1, so the swing starts then and must
    // still be running a whole tick before its declared duration is up.
    const { tipTick } = run(structures, regions, loaded, world, 400);

    expect(structures.currentUpRegionId('seesaw')).toBe('cell-b');
    // Started on tick 1 at t = DT, so it completes one swing later.
    expect((tipTick as number) * DT).toBeCloseTo(DT + SWING_SEC, 2);
  });

  it('reports a swing in progress, and stops reporting one once it has landed', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();
    const loaded = snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]]));

    run(structures, regions, loaded, world, 100);
    expect(structures.isTipping('seesaw')).toBe(true);
    expect(structures.tipProgress('seesaw')).toBeGreaterThan(0);
    expect(structures.tipProgress('seesaw')).toBeLessThan(1);
    // Mid-swing the cells have not swapped yet: the loaded cell is still up.
    expect(structures.currentUpRegionId('seesaw')).toBe('cell-a');

    run(structures, regions, loaded, world, 400);
    expect(structures.isTipping('seesaw')).toBe(false);
    expect(structures.tipProgress('seesaw')).toBe(0);
  });

  it('comes over faster the further past its threshold the load is', () => {
    const atThreshold = new TippingStructures([SPEC]);
    const overloaded = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);

    const light = run(
      atThreshold,
      regions,
      snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])),
      new FakeWorld(),
      600,
    );
    // Three light balls instead of two: 1.5x the threshold load.
    const heavy = run(
      overloaded,
      regions,
      snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A], ['c', IN_CELL_A]])),
      new FakeWorld(),
      600,
    );

    expect(light.tipTick).not.toBeNull();
    expect(heavy.tipTick).not.toBeNull();
    expect(heavy.tipTick as number).toBeLessThan(light.tipTick as number);
    // Inverse in the load, so 1.5x the load is 2/3 of the swing.
    expect(tipDurationSec(SPEC, LIGHT_KG * 3)).toBeCloseTo((SWING_SEC * 2) / 3, 6);
  });

  it('does not tip on a count alone when the pieces are too light to reach the threshold', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    const { events } = run(
      structures,
      regions,
      snapshot(
        new Map([
          ['a', { at: IN_CELL_A, massKg: LIGHT_KG / 2 }],
          ['b', { at: IN_CELL_A, massKg: LIGHT_KG / 2 }],
          ['c', { at: IN_CELL_A, massKg: LIGHT_KG / 2 }],
        ]),
      ),
      world,
      600,
    );

    expect(events).toEqual([]);
    expect(structures.tipCount('seesaw')).toBe(0);
    expect(structures.isTipping('seesaw')).toBe(false);
  });

  it('weighs the load rather than counting it, so one heavy piece tips what two light ones do', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    const { events } = run(
      structures,
      regions,
      snapshot(new Map([['heavy', { at: IN_CELL_A, massKg: HEAVY_KG }]])),
      world,
      400,
    );

    expect(events).toHaveLength(1);
    expect(structures.tipCount('seesaw')).toBe(1);
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

  it('dumps pieces along the real axis between the two cells, not a fixed world axis', () => {
    // CELL_A and CELL_B differ only in Y (20 in apart), so a dump must send
    // pieces along Y — the bug this guards sent everything along +X instead,
    // regardless of how the two cells were actually arranged.
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    run(structures, regions, snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])), world, 400);

    for (const pieceId of ['a', 'b']) {
      const v = world.velocities.get(pieceId);
      expect(v).toBeDefined();
      // CELL_A (the one dumping) is in the +Y direction from CELL_B, so the
      // dump continues outward along +Y.
      expect(v!.y).toBeGreaterThan(0);
      // Nominal 0.5 m/s +/- the jitter fraction tipper.ts declares.
      expect(Math.hypot(v!.x, v!.y)).toBeGreaterThan(0.1);
      expect(Math.hypot(v!.x, v!.y)).toBeLessThan(0.9);
    }
  });

  it('scatters a multi-piece dump instead of sending every piece on the same line', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();

    run(structures, regions, snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]])), world, 400);

    expect(world.velocities.get('a')).not.toEqual(world.velocities.get('b'));
  });

  it('does not tip again on the very next tick just because a dumped piece has not moved yet', () => {
    const structures = new TippingStructures([SPEC]);
    const regions = resolveTippingRegions([SPEC], [CELL_A, CELL_B]);
    const world = new FakeWorld();
    const loaded = snapshot(new Map([['a', IN_CELL_A], ['b', IN_CELL_A]]));

    const { tipTick } = run(structures, regions, loaded, world, 400);
    // Cell A is now the down cell; pieces still physically there this tick
    // (before they have actually moved away) must not count toward cell B
    // tipping again, and cell B is empty, so nothing should tip.
    const after = structures.update(regions, loaded, 401, 401 * DT, world);
    expect(tipTick).not.toBeNull();
    expect(after).toEqual([]);
    expect(structures.currentUpRegionId('seesaw')).toBe('cell-b');
  });
});

describe('resolveTippingRegions', () => {
  it('throws when a structure names a region that does not exist', () => {
    expect(() => resolveTippingRegions([SPEC], [CELL_A])).toThrow(/cell-b/);
  });
});
