/**
 * Piece conveyors: the field's own mechanisms.
 *
 * Two layers are asserted here. The generic one — queue, capacity, bypass,
 * gated drain, a real push on the way out — is exercised on a made-up
 * conveyor with no season attached, to prove the engine has no idea what a
 * CLASSIFIER is. The DECODE one is in `decodeMatch.test.ts`, where a real shot
 * arrives in a real GOAL and a real ARTIFACT rolls down a real SECRET TUNNEL.
 */

import { describe, expect, it } from 'vitest';
import {
  PieceConveyors,
  nearEndOf,
  resolveConveyorPlaces,
  slotPoint,
  type ConveyorWorld,
  type PieceConveyorSpec,
} from './conveyor.js';
import { createRectRegion, createRectZone } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';

const DT = 1 / 200;

const ENTRY = createRectRegion({ id: 'entry', centerXIn: 0, centerYIn: 60, widthIn: 20, lengthIn: 20 });
const QUEUE = createRectRegion({ id: 'queue', centerXIn: 0, centerYIn: 20, widthIn: 10, lengthIn: 60 });
const EXIT = createRectZone({ id: 'exit', centerXIn: 40, centerYIn: 0, widthIn: 8, lengthIn: 48 });
const OPENER = createRectZone({ id: 'opener', centerXIn: 0, centerYIn: -20, widthIn: 10, lengthIn: 10 });

/** Away from the queue, along the exit corridor's own axis (see below). */
const EXIT_VELOCITY_MPS = vec2(0, 2);

const SPEC: PieceConveyorSpec = {
  id: 'chute',
  entryRegionId: 'entry',
  queueRegionId: 'queue',
  capacity: 3,
  releaseZoneId: 'opener',
  exitZoneId: 'exit',
  exitVelocityMps: EXIT_VELOCITY_MPS,
  drainIntervalSec: 0.25,
};

const places = (spec: PieceConveyorSpec = SPEC) =>
  resolveConveyorPlaces([spec], [ENTRY, QUEUE], [EXIT, OPENER]);

/** A tiny world: pieces at declared points, and one robot that can be moved. */
class FakeWorld implements ConveyorWorld {
  readonly held = new Map<string, Vec2>();
  readonly released = new Map<string, { readonly positionM: Vec2; readonly velocityM: Vec2 }>();

  constructor(
    private readonly positions: Map<string, Vec2>,
    private robotAt: Vec2 | null = null,
  ) {}

  holdPiece(pieceId: string, positionM: Vec2): void {
    this.held.set(pieceId, positionM);
    this.released.delete(pieceId);
    this.positions.set(pieceId, positionM);
  }

  releasePieceMoving(pieceId: string, positionM: Vec2, velocityM: Vec2): void {
    this.released.set(pieceId, { positionM, velocityM });
    this.held.delete(pieceId);
    this.positions.set(pieceId, positionM);
  }

  moveRobot(to: Vec2 | null): void {
    this.robotAt = to;
  }

  snapshot(tick: number): WorldSnapshot {
    return {
      tick,
      timeSec: tick * DT,
      batteryVolts: 12,
      batteryCurrentA: 0,
      robots:
        this.robotAt === null
          ? []
          : [
              {
                id: 0,
                name: 'r',
                alliance: 'red',
                pose: { p: this.robotAt, theta: 0 },
                previousPose: { p: this.robotAt, theta: 0 },
                vel: { v: vec2(0, 0), omega: 0 },
                chassis: { vx: 0, vy: 0, omega: 0 },
                accelerationMps2: 0,
                lengthM: 0.4572,
                widthM: 0.4572,
                heightM: 0.4572,
                gearRatio: 1,
                wheelRadiusM: 0.048,
                drive: {
                  duties: { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0 },
                  motorSpeeds: { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0 },
                  motorTorques: { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0 },
                  motorCurrents: { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0 },
                  wheelForces: { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0 },
                },
                mechanisms: {
                  held: [],
                  capacity: 0,
                  intake: 'off',
                  hasIntake: false,
                  hasLauncher: false,
                },
              },
            ],
      pieces: [...this.positions].map(([pieceId, p], index) => ({
        id: 100 + index,
        pieceId,
        pieceType: 'P',
        pose: { p, theta: 0 },
        previousPose: { p, theta: 0 },
        vel: { v: vec2(0, 0), omega: 0 },
        radiusM: 0.06223,
        heightM: 0.06223,
        previousHeightM: 0.06223,
        verticalVelocityMps: 0,
        airborne: false,
        heldByRobotId: null,
      })),
    };
  }
}

const inEntry = (i: number): Vec2 => vec2(0, 60 * 0.0254 + i * 1e-4);
const away = vec2(0, -60 * 0.0254);

function run(
  pieceIds: readonly string[],
  ticks: number,
  options: { spec?: PieceConveyorSpec; robotAt?: Vec2 | null; openAt?: number } = {},
): { conveyors: PieceConveyors; world: FakeWorld } {
  const spec = options.spec ?? SPEC;
  const positions = new Map(pieceIds.map((id, i) => [id, inEntry(i)] as const));
  const world = new FakeWorld(positions, options.robotAt ?? null);
  const conveyors = new PieceConveyors([spec], places(spec), DT);

  for (let tick = 0; tick < ticks; tick++) {
    if (options.openAt !== undefined && tick === options.openAt) {
      world.moveRobot(vec2(0, -20 * 0.0254));
    }
    conveyors.update(world.snapshot(tick), tick, world);
  }
  return { conveyors, world };
}

describe('taking pieces in', () => {
  it('queues an arrival in the entry region', () => {
    const { conveyors } = run(['a'], 1);
    expect(conveyors.queued('chute')).toEqual(['a']);
  });

  it('ignores a piece that is nowhere near', () => {
    const positions = new Map([['a', away]]);
    const world = new FakeWorld(positions);
    const conveyors = new PieceConveyors([SPEC], places(), DT);
    conveyors.update(world.snapshot(0), 0, world);

    expect(conveyors.queued('chute')).toEqual([]);
  });

  it('parks queued pieces at their slots along the queue region', () => {
    const { conveyors, world } = run(['a', 'b'], 1);

    expect(conveyors.queued('chute')).toEqual(['a', 'b']);
    const first = world.held.get('a');
    const second = world.held.get('b');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The queue region is longer in y, so slots run along y with slot 0 low.
    expect(first?.y ?? 0).toBeLessThan(second?.y ?? 0);
  });

  it('takes each piece once, however long it sits in the entry', () => {
    const { conveyors } = run(['a'], 100);
    expect(conveyors.queued('chute')).toEqual(['a']);
  });

  it('stops queueing at capacity and pushes the rest straight through', () => {
    const { conveyors, world } = run(['a', 'b', 'c', 'd'], 1);

    expect(conveyors.queued('chute')).toEqual(['a', 'b', 'c']);
    // No virtual transit delay: an overflowing arrival is released the same
    // tick it would have queued, moving under a real, immediate velocity.
    expect(world.released.has('d')).toBe(true);
    expect(world.released.get('d')?.velocityM).toEqual(EXIT_VELOCITY_MPS);
  });

  it('releases an overflowing piece at the exit corridor\'s near end', () => {
    const { world } = run(['a', 'b', 'c', 'd'], 1);
    const at = world.released.get('d')?.positionM;

    expect(at).toBeDefined();
    if (at === undefined) return;
    expect(at).toEqual(nearEndOf(EXIT, QUEUE.centerM));
  });
});

describe('letting pieces out', () => {
  it('holds the queue while nothing opens the way out', () => {
    const { conveyors, world } = run(['a', 'b', 'c'], 400);

    expect(conveyors.queued('chute')).toEqual(['a', 'b', 'c']);
    expect(world.released.size).toBe(0);
  });

  it('drains once a robot is in the release zone', () => {
    const { conveyors } = run(['a', 'b', 'c'], 400, { openAt: 10 });
    expect(conveyors.queued('chute')).toEqual([]);
  });

  it('drains in arrival order, way-out end first', () => {
    const drainTicks = Math.round(SPEC.drainIntervalSec / DT);
    const { conveyors } = run(['a', 'b', 'c'], 10 + drainTicks, { openAt: 10 });

    // One gone by the time the second interval is due, and it is the one that
    // arrived first.
    expect(conveyors.queued('chute')).toEqual(['b', 'c']);
  });

  /**
   * Not instantaneous: a gate held open only briefly clears part of the queue,
   * which is exactly the behaviour the manual warns teams to plan for.
   */
  it('cannot empty the queue in a single tick', () => {
    const { conveyors } = run(['a', 'b', 'c'], 12, { openAt: 10 });
    expect(conveyors.queued('chute').length).toBeGreaterThan(0);
  });

  it('gives a drained piece the same real push an overflow gets', () => {
    const { world } = run(['a'], 15, { openAt: 10 });
    const released = world.released.get('a');

    expect(released).toBeDefined();
    expect(released?.velocityM).toEqual(EXIT_VELOCITY_MPS);
    expect(released?.positionM).toEqual(nearEndOf(EXIT, QUEUE.centerM));
  });

  it('reports whether the way out is open', () => {
    const positions = new Map([['a', inEntry(0)]]);
    const closed = new FakeWorld(positions);
    expect(closed.snapshot(0).robots).toHaveLength(0);

    const conveyors = new PieceConveyors([SPEC], places(), DT);
    expect(conveyors.isOpen('chute', closed.snapshot(0))).toBe(false);

    closed.moveRobot(vec2(0, -20 * 0.0254));
    expect(conveyors.isOpen('chute', closed.snapshot(1))).toBe(true);
  });

  it('only opens for the alliance that owns it', () => {
    const blueOnly: PieceConveyorSpec = { ...SPEC, releaseAlliance: 'blue' };
    const { conveyors } = run(['a', 'b'], 400, { spec: blueOnly, openAt: 10 });

    // The fake robot is red, so blue's gate stays shut.
    expect(conveyors.queued('chute')).toEqual(['a', 'b']);
  });

  it('drains freely when no release zone is declared', () => {
    const { releaseZoneId: _drop, ...ungated } = SPEC;
    const { conveyors } = run(['a', 'b'], 400, { spec: ungated });

    expect(conveyors.queued('chute')).toEqual([]);
  });

  it('conserves pieces: everything taken in comes back out', () => {
    const { releaseZoneId: _drop, ...ungated } = SPEC;
    const { conveyors, world } = run(['a', 'b', 'c', 'd', 'e'], 800, { spec: ungated });

    expect(conveyors.queued('chute')).toEqual([]);
    expect([...world.released.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('slot geometry', () => {
  it('runs slots along the longer axis, low end first', () => {
    const low = slotPoint(QUEUE, 3, 0);
    const high = slotPoint(QUEUE, 3, 2);

    expect(low.y).toBeLessThan(high.y);
    expect(low.x).toBeCloseTo(QUEUE.centerM.x, 12);
  });

  it('centres a single slot on the region', () => {
    expect(slotPoint(QUEUE, 1, 0)).toEqual(QUEUE.centerM);
  });

  it('keeps every slot inside the region', () => {
    const halfLength = (60 * 0.0254) / 2;
    for (let i = 0; i < 9; i++) {
      const at = slotPoint(QUEUE, 9, i);
      expect(Math.abs(at.y - QUEUE.centerM.y)).toBeLessThan(halfLength);
    }
  });

  it('clamps an index past the end rather than running off the region', () => {
    expect(slotPoint(QUEUE, 3, 99)).toEqual(slotPoint(QUEUE, 3, 2));
  });
});

describe('near-end geometry', () => {
  it('picks whichever end of the exit corridor is closer to the reference point', () => {
    // EXIT is 8 x 48 in at (40, 0): its long axis is Y, ends at y = ±24 in.
    const nearHigh = nearEndOf(EXIT, vec2(EXIT.centerM.x, EXIT.centerM.y + 100));
    const nearLow = nearEndOf(EXIT, vec2(EXIT.centerM.x, EXIT.centerM.y - 100));

    expect(nearHigh.y).toBeGreaterThan(EXIT.centerM.y);
    expect(nearLow.y).toBeLessThan(EXIT.centerM.y);
  });

  it('stays on the shape, not merely near it', () => {
    const at = nearEndOf(EXIT, vec2(1000, 1000));
    expect(Math.abs(at.x - EXIT.centerM.x)).toBeLessThan(1e-9);
    expect(Math.abs(at.y - EXIT.centerM.y)).toBeLessThanOrEqual(EXIT.centerM.y + 24 * 0.0254 + 1e-9);
  });
});

describe('declaration errors', () => {
  it('names the region a conveyor points at and cannot find', () => {
    expect(() =>
      resolveConveyorPlaces([{ ...SPEC, entryRegionId: 'nope' }], [ENTRY, QUEUE], [EXIT, OPENER]),
    ).toThrow(/nope/);
  });

  it('names a missing exit zone', () => {
    expect(() =>
      resolveConveyorPlaces([{ ...SPEC, exitZoneId: 'nowhere' }], [ENTRY, QUEUE], [EXIT, OPENER]),
    ).toThrow(/nowhere/);
  });

  it('names a missing release zone', () => {
    expect(() =>
      resolveConveyorPlaces([{ ...SPEC, releaseZoneId: 'unopenable' }], [ENTRY, QUEUE], [EXIT, OPENER]),
    ).toThrow(/unopenable/);
  });
});
