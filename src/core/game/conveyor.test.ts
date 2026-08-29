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
  farEndOf,
  nearEndOf,
  queuePoint,
  resolveConveyorPlaces,
  slotPoint,
  type ConveyorWorld,
  type PieceConveyorSpec,
} from './conveyor.js';
import { createRectRegion, createRectZone } from './regions.js';
import { vec2, type Vec2 } from '../math/vec2.js';
import type { WorldSnapshot } from '../sim/snapshot.js';
import { inchesToMeters } from '../units/convert.js';

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

const GUIDED_SPEC: PieceConveyorSpec = {
  ...SPEC,
  lane: {
    travelDirection: vec2(0, -1),
    driveAccelerationMps2: 2,
    maxDriveSpeedMps: 1,
    lateralCenteringAccelerationMps2: 2,
    gateColliderTag: 'chute-gate',
    overflowHeightM: 0.3,
    overflowHeightRateMps: 1,
    entryVelocityRetention: 0.2,
  },
};

const places = (spec: PieceConveyorSpec = SPEC) =>
  resolveConveyorPlaces([spec], [ENTRY, QUEUE], [EXIT, OPENER]);

/**
 * A queue/exit pair actually aligned with `GUIDED_SPEC.lane`'s -Y travel
 * direction. `QUEUE`/`EXIT` above are built for the parked-slot tests, whose
 * exit sits off to the side (`+X`) rather than down the corridor a driven
 * piece travels — fine for a release that gets an explicit push in an
 * arbitrary direction, wrong for a piece a lane actually has to accelerate
 * into the exit zone under its own guidance.
 */
const LANE_QUEUE = createRectRegion({ id: 'lane-queue', centerXIn: 0, centerYIn: 20, widthIn: 10, lengthIn: 80 });
const LANE_EXIT = createRectZone({ id: 'lane-exit', centerXIn: 0, centerYIn: -30, widthIn: 10, lengthIn: 20 });

const LANE_SPEC: PieceConveyorSpec = {
  ...GUIDED_SPEC,
  queueRegionId: 'lane-queue',
  exitZoneId: 'lane-exit',
};

const lanePlaces = (spec: PieceConveyorSpec = LANE_SPEC) =>
  resolveConveyorPlaces([spec], [ENTRY, LANE_QUEUE], [LANE_EXIT, OPENER]);

/** A tiny world: pieces at declared points, and one robot that can be moved. */
class FakeWorld implements ConveyorWorld {
  readonly held = new Map<string, Vec2>();
  readonly released = new Map<string, { readonly positionM: Vec2; readonly velocityM: Vec2 }>();
  readonly blocked = new Map<string, Vec2>();
  readonly guided = new Map<
    string,
    {
      readonly accelerationMps2: Vec2;
      readonly targetHeightM?: number | undefined;
      readonly heightRateMps?: number | undefined;
    }
  >();
  readonly colliderStates = new Map<string, boolean>();
  readonly pushedOut = new Map<string, Vec2>();
  readonly completedTransfers = new Set<string>();

  constructor(
    private readonly positions: Map<string, Vec2>,
    private robotAt: Vec2 | null = null,
    private readonly velocities: Map<string, Vec2> = new Map(),
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

  placeAcceptedTransfer(pieceId: string, positionM: Vec2, velocityM: Vec2): void {
    this.released.set(pieceId, { positionM, velocityM });
    this.positions.set(pieceId, positionM);
  }

  setPieceVelocity(pieceId: string, velocityM: Vec2): void {
    const positionM = this.positions.get(pieceId);
    if (positionM === undefined) throw new Error(`unknown piece ${pieceId}`);
    this.released.set(pieceId, { positionM, velocityM });
  }

  blockPiece(pieceId: string, positionM: Vec2): void {
    this.blocked.set(pieceId, positionM);
    this.released.delete(pieceId);
    this.positions.set(pieceId, positionM);
  }

  guidePiece(pieceId: string, accelerationMps2: Vec2, targetHeightM?: number, heightRateMps?: number): void {
    this.guided.set(pieceId, { accelerationMps2, targetHeightM, heightRateMps });
  }

  setColliderTagActive(tag: string, active: boolean): void {
    this.colliderStates.set(tag, active);
  }

  pushPieceOutOfGate(pieceId: string, positionM: Vec2): void {
    this.pushedOut.set(pieceId, positionM);
    this.positions.set(pieceId, positionM);
  }

  dampPieceVelocity(_pieceId: string, _retention: number): void {}

  completePieceTransfer(pieceId: string): void {
    this.completedTransfers.add(pieceId);
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
        vel: { v: this.velocities.get(pieceId) ?? vec2(0, 0), omega: 0 },
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
  options: {
    spec?: PieceConveyorSpec;
    robotAt?: Vec2 | null;
    openAt?: number;
    velocities?: Map<string, Vec2>;
  } = {},
): { conveyors: PieceConveyors; world: FakeWorld } {
  const spec = options.spec ?? SPEC;
  const positions = new Map(pieceIds.map((id, i) => [id, inEntry(i)] as const));
  const world = new FakeWorld(positions, options.robotAt ?? null, options.velocities ?? new Map());
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

  it('uses a declared lane without parking pieces or assigning fixed slots', () => {
    const { conveyors, world } = run(['a', 'b', 'c', 'd'], 1, { spec: GUIDED_SPEC });

    // Three occupy the physical lane; the fourth is an elevated overflow
    // traveller. All remain active bodies receiving ordinary guidance.
    expect(conveyors.queued('chute')).toEqual(['a', 'b', 'c']);
    expect(world.held.size).toBe(0);
    expect([...world.guided.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(world.colliderStates.get('chute-gate')).toBe(true);
  });
});

describe('guided lane physics', () => {
  const NINE = { ...GUIDED_SPEC, capacity: 9 };
  const NAMES = 'abcdefghijk'.split('');

  it('packs up to capacity with no held position and no assigned slot for any of them', () => {
    const { conveyors, world } = run(NAMES.slice(0, 9), 1, { spec: NINE });

    expect(conveyors.queued('chute')).toEqual(NAMES.slice(0, 9));
    expect(conveyors.overflowed('chute')).toEqual([]);
    // Nothing here is "parked" — a lane piece is never given a fixed position,
    // only a per-tick acceleration the ordinary collision solver resolves.
    expect(world.held.size).toBe(0);
    for (const id of NAMES.slice(0, 9)) expect(world.guided.has(id)).toBe(true);
  });

  it('sends the tenth and eleventh arrivals to the elevated overflow path, not a virtual slot', () => {
    const { conveyors } = run(NAMES.slice(0, 11), 1, { spec: NINE });

    expect(conveyors.queued('chute')).toEqual(NAMES.slice(0, 9));
    expect(conveyors.overflowed('chute')).toEqual(NAMES.slice(9, 11));
  });

  it('rides an overflow piece at the lane\'s declared overflow height, unlike a packed one', () => {
    const { world } = run(NAMES.slice(0, 10), 1, { spec: NINE });

    const packed = world.guided.get(NAMES[0] as string);
    const overflow = world.guided.get(NAMES[9] as string);
    expect(packed?.targetHeightM).toBeUndefined();
    expect(overflow?.targetHeightM).toBe(NINE.lane?.overflowHeightM);
    expect(overflow?.heightRateMps).toBe(NINE.lane?.overflowHeightRateMps);
  });

  it('keeps guiding an overflow piece over the top even while the gate stays closed', () => {
    // No robot ever opens the release zone: the gate collider stays active
    // the whole time. §9.8.3's OVERFLOW explicitly does not wait for one.
    const { conveyors, world } = run(NAMES.slice(0, 10), 5, { spec: NINE });

    expect(world.colliderStates.get(NINE.lane?.gateColliderTag as string)).toBe(true);
    expect(conveyors.overflowed('chute')).toContain(NAMES[9]);
    expect(world.guided.has(NAMES[9] as string)).toBe(true);
  });

  it('opens the gate collider once latched, and closes it again once the queue empties', () => {
    const { world } = run(['a', 'b', 'c'], 1, { spec: GUIDED_SPEC });
    expect(world.colliderStates.get('chute-gate')).toBe(true);

    const { world: opened } = run(['a', 'b', 'c'], 1, { spec: GUIDED_SPEC, openAt: 0 });
    expect(opened.colliderStates.get('chute-gate')).toBe(false);

    // Draining a physical lane has no per-piece timer: a piece leaves the
    // instant its own real position reaches the exit zone. Rather than
    // simulate the many ticks of real motion that would take (this harness
    // hands out accelerations; it does not integrate them), move the one
    // piece there directly and confirm the very next update both releases it
    // and, seeing nothing left queued, lets the latch — and the gate
    // collider it drives — close again.
    const positions = new Map([['a', inEntry(0)]]);
    const world2 = new FakeWorld(positions);
    const conveyors = new PieceConveyors([LANE_SPEC], lanePlaces(), DT);
    world2.moveRobot(vec2(0, -20 * 0.0254));
    conveyors.update(world2.snapshot(0), 0, world2);
    world2.moveRobot(null);
    expect(conveyors.queued('chute')).toEqual(['a']);
    expect(world2.colliderStates.get('chute-gate')).toBe(false);

    positions.set('a', LANE_EXIT.centerM);
    conveyors.update(world2.snapshot(1), 1, world2);
    expect(conveyors.queued('chute')).toEqual([]);

    // The departing ball must clear the actual passage before gravity closes
    // the arm behind it. (The fake harness does not integrate its velocity.)
    positions.set('a', away);
    conveyors.update(world2.snapshot(2), 2, world2);
    expect(world2.colliderStates.get('chute-gate')).toBe(true);
  });

  it('gravity-closes a touched gate after its quiet window when no normal lane ball flows', () => {
    const timedLane: PieceConveyorSpec = { ...GUIDED_SPEC, releaseOpenWindowSec: 0.05 };
    const world = new FakeWorld(new Map(), vec2(0, -20 * 0.0254));
    const conveyors = new PieceConveyors([timedLane], places(timedLane), DT);

    conveyors.update(world.snapshot(0), 0, world);
    expect(conveyors.isOpen('chute', world.snapshot(1))).toBe(true);
    expect(world.colliderStates.get('chute-gate')).toBe(false);

    // The robot is still touching, but that is one physical push rather than
    // a perpetual command. With no ball passing the gate, gravity closes it.
    conveyors.update(world.snapshot(10), 10, world);
    expect(conveyors.isOpen('chute', world.snapshot(11))).toBe(false);
    expect(world.colliderStates.get('chute-gate')).toBe(true);
  });

  it('pushes a normal lane ball clear before a timed gate closes through it', () => {
    const timedLane: PieceConveyorSpec = { ...LANE_SPEC, releaseOpenWindowSec: 0.05 };
    const positions = new Map([['a', inEntry(0)]]);
    const gate = vec2(0, -20 * 0.0254);
    const world = new FakeWorld(positions, gate);
    const conveyors = new PieceConveyors([timedLane], lanePlaces(timedLane), DT);

    conveyors.update(world.snapshot(0), 0, world);
    world.moveRobot(null);

    // A 4.9 in ARTIFACT four inches upstream is pressing the GATE, but is
    // not yet in the return zone.  The closing arm must resolve this overlap
    // before its collider becomes active again.
    const gateM = nearEndOf(LANE_EXIT, LANE_QUEUE.centerM);
    positions.set('a', vec2(gateM.x, gateM.y + inchesToMeters(4)));
    conveyors.update(world.snapshot(10), 10, world);

    const cleared = world.pushedOut.get('a');
    expect(cleared).toBeDefined();
    expect(cleared?.x).toBeCloseTo(gateM.x);
    expect(cleared?.y).toBeCloseTo(gateM.y + 0.06223 * 3);
    expect(world.colliderStates.get('chute-gate')).toBe(true);
    expect(conveyors.isOpen('chute', world.snapshot(11))).toBe(false);
  });

  it('returns a ball still inside an open gate passage to the lane before closing', () => {
    const timedLane: PieceConveyorSpec = { ...LANE_SPEC, releaseOpenWindowSec: 0.05 };
    const positions = new Map([['a', inEntry(0)]]);
    const gate = vec2(0, -20 * 0.0254);
    const world = new FakeWorld(positions, gate);
    const conveyors = new PieceConveyors([timedLane], lanePlaces(timedLane), DT);

    conveyors.update(world.snapshot(0), 0, world);
    // The ball has physically crossed the retracted arm, but a robot blocks
    // the return passage long enough for the live gate's quiet window to end.
    positions.set('a', LANE_EXIT.centerM);
    conveyors.update(world.snapshot(1), 1, world);
    expect(conveyors.queued('chute')).toEqual([]);

    world.moveRobot(null);
    conveyors.update(world.snapshot(12), 12, world);

    const gateM = nearEndOf(LANE_EXIT, LANE_QUEUE.centerM);
    expect(conveyors.queued('chute')).toEqual(['a']);
    expect(world.pushedOut.get('a')?.y).toBeCloseTo(gateM.y + 0.06223 * 3);
    expect(world.colliderStates.get('chute-gate')).toBe(true);
  });

  it('clears a normal lane ball that later overlaps an already-closed gate', () => {
    const positions = new Map([['a', inEntry(0)]]);
    const world = new FakeWorld(positions);
    const conveyors = new PieceConveyors([LANE_SPEC], lanePlaces(), DT);

    conveyors.update(world.snapshot(0), 0, world);
    const gateM = nearEndOf(LANE_EXIT, LANE_QUEUE.centerM);
    // Just upstream of the exit zone but inside one ball radius of the arm.
    // It is not a legitimate release, so the closed-GATE guard owns it.
    positions.set('a', vec2(gateM.x, gateM.y + inchesToMeters(2)));
    conveyors.update(world.snapshot(1), 1, world);

    const cleared = world.pushedOut.get('a');
    expect(cleared).toBeDefined();
    expect(cleared?.y).toBeCloseTo(gateM.y + 0.06223 * 3);
    expect(world.colliderStates.get('chute-gate')).toBe(true);
  });

  it('does not release a normal lane ball through a closed live gate', () => {
    const positions = new Map([['a', inEntry(0)]]);
    const world = new FakeWorld(positions);
    const conveyors = new PieceConveyors([LANE_SPEC], lanePlaces(), DT);

    conveyors.update(world.snapshot(0), 0, world);
    positions.set('a', LANE_EXIT.centerM);
    conveyors.update(world.snapshot(1), 1, world);

    expect(conveyors.queued('chute')).toEqual(['a']);
    expect(world.released.has('a')).toBe(false);
    expect(world.colliderStates.get('chute-gate')).toBe(true);
  });

  it('re-opens a held gate only when its leading physical lane ball reaches the arm', () => {
    const timedLane: PieceConveyorSpec = { ...LANE_SPEC, releaseOpenWindowSec: 0.05 };
    const positions = new Map([['a', inEntry(0)]]);
    const gate = vec2(0, -20 * 0.0254);
    const world = new FakeWorld(positions, gate);
    const conveyors = new PieceConveyors([timedLane], lanePlaces(timedLane), DT);

    conveyors.update(world.snapshot(0), 0, world);
    conveyors.update(world.snapshot(10), 10, world);
    expect(conveyors.isOpen('chute', world.snapshot(11))).toBe(false);

    // A normal lane disc that is physically pressing the closed arm makes the
    // same held gate reopen. The latch remains a short flow window, rather
    // than an indefinitely open gate merely because a robot stayed nearby.
    const gateM = nearEndOf(LANE_EXIT, LANE_QUEUE.centerM);
    // Four inches upstream of the exit is outside the return zone but within
    // the two-radius gate-contact threshold for this 4.9 in test disc.
    positions.set('a', vec2(gateM.x, gateM.y + inchesToMeters(4)));
    conveyors.update(world.snapshot(11), 11, world);
    expect(conveyors.isOpen('chute', world.snapshot(12))).toBe(true);
    expect(world.colliderStates.get('chute-gate')).toBe(false);
  });

  it('governs the down-lane drive so an unblocked piece cruises rather than accelerating forever', () => {
    const lane = GUIDED_SPEC.lane;
    if (lane === undefined) throw new Error('GUIDED_SPEC needs a lane');
    const direction = lane.travelDirection;

    // Entering exactly on the queue's own centreline (shared x = 0) removes
    // the lateral term, so the guided acceleration below is the drive term
    // alone. The piece has to start inside the entry region to be taken at
    // all, so this cannot simply sit at `QUEUE.centerM`.
    const positions = new Map([['a', inEntry(0)]]);

    const belowCap = new FakeWorld(positions, null, new Map([['a', vec2(0, 0)]]));
    const belowConveyors = new PieceConveyors([GUIDED_SPEC], places(GUIDED_SPEC), DT);
    belowConveyors.update(belowCap.snapshot(0), 0, belowCap);
    expect(belowCap.guided.get('a')?.accelerationMps2).toEqual(
      vec2(direction.x * lane.driveAccelerationMps2, direction.y * lane.driveAccelerationMps2),
    );

    const atCap = new FakeWorld(
      positions,
      null,
      new Map([['a', vec2(direction.x * lane.maxDriveSpeedMps, direction.y * lane.maxDriveSpeedMps)]]),
    );
    const atCapConveyors = new PieceConveyors([GUIDED_SPEC], places(GUIDED_SPEC), DT);
    atCapConveyors.update(atCap.snapshot(0), 0, atCap);
    // Already at the governed cruise speed: no further push down the lane.
    expect(atCap.guided.get('a')?.accelerationMps2).toEqual(vec2(0, 0));
  });

  it('keeps a lane piece flowing after the one ahead of it clears the exit, with no reassignment', () => {
    const positions = new Map([
      ['a', inEntry(0)],
      ['b', inEntry(1)],
    ]);
    const world = new FakeWorld(positions, vec2(0, -20 * 0.0254));
    const conveyors = new PieceConveyors([LANE_SPEC], lanePlaces(), DT);
    conveyors.update(world.snapshot(0), 0, world);
    world.moveRobot(null);
    expect(conveyors.queued('chute')).toEqual(['a', 'b']);

    // 'a' physically reaches the exit; 'b' does not move. Nothing here
    // re-slots 'b' into 'a's old place — it was never in a slot, and it
    // keeps receiving the exact same per-tick guidance either way.
    positions.set('a', LANE_EXIT.centerM);
    conveyors.update(world.snapshot(1), 1, world);

    // The piece reached this point under its own real motion. The gate now
    // supplies the declared outflow velocity at that exact point — it is not
    // repositioned at the end of the tunnel like a legacy drain would be.
    expect(conveyors.queued('chute')).toEqual(['b']);
    expect(conveyors.overflowed('chute')).toEqual([]);
    expect(world.guided.has('b')).toBe(true);
    expect(world.released.get('a')).toEqual({
      positionM: LANE_EXIT.centerM,
      velocityM: EXIT_VELOCITY_MPS,
    });
  });

  it('still rejects a piece rolling backward into a one-way lane exit', () => {
    const oneWayLane: PieceConveyorSpec = { ...GUIDED_SPEC, blocksInboundExit: true };
    const publicMouth = farEndOf(EXIT, QUEUE.centerM);
    const positions = new Map([['intruder', publicMouth]]);
    const world = new FakeWorld(positions);
    const conveyors = new PieceConveyors([oneWayLane], places(oneWayLane), DT);

    const snapshot = world.snapshot(0);
    const piece = snapshot.pieces[0];
    if (piece === undefined) throw new Error('piece missing');
    const inbound = { ...snapshot, pieces: [{ ...piece, vel: { v: vec2(0, -1), omega: 0 } }] };
    conveyors.update(inbound, 0, world);

    expect(world.blocked.get('intruder')).toBeDefined();
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

  it('latches one gate activation until every queued piece has left', () => {
    const positions = new Map(['a', 'b', 'c'].map((id, index) => [id, inEntry(index)] as const));
    const world = new FakeWorld(positions);
    const conveyors = new PieceConveyors([SPEC], places(), DT);
    const gate = vec2(0, -20 * 0.0254);

    // First tick: the robot opens the gate. It immediately leaves, as it would
    // after pushing a gravity-return gate rather than remaining parked on it.
    world.moveRobot(gate);
    conveyors.update(world.snapshot(0), 0, world);
    world.moveRobot(null);
    expect(conveyors.isOpen('chute', world.snapshot(1))).toBe(true);

    const drainTicks = Math.round(SPEC.drainIntervalSec / DT);
    for (let tick = 1; tick <= drainTicks * 3 + 2; tick++) {
      conveyors.update(world.snapshot(tick), tick, world);
    }

    expect(conveyors.queued('chute')).toEqual([]);
    expect([...world.released.keys()]).toEqual(['a', 'b', 'c']);
    // The latch closes after its final ball, ready for a new activation.
    expect(conveyors.isOpen('chute', world.snapshot(drainTicks * 3 + 3))).toBe(false);
  });

  it('closes after draining even when the activating robot remains at the gate', () => {
    const positions = new Map(['a', 'b', 'c'].map((id, index) => [id, inEntry(index)] as const));
    const gate = vec2(0, -20 * 0.0254);
    const world = new FakeWorld(positions, gate);
    const conveyors = new PieceConveyors([SPEC], places(), DT);

    // The robot remains in the release zone for the entire drain. That is one
    // touch, not an instruction to re-open an empty GATE every simulation tick.
    conveyors.update(world.snapshot(0), 0, world);
    expect(conveyors.isOpen('chute', world.snapshot(1))).toBe(true);

    const drainTicks = Math.round(SPEC.drainIntervalSec / DT);
    for (let tick = 1; tick <= drainTicks * 3 + 2; tick++) {
      conveyors.update(world.snapshot(tick), tick, world);
    }

    expect(conveyors.queued('chute')).toEqual([]);
    expect([...world.released.keys()]).toEqual(['a', 'b', 'c']);
    expect(conveyors.isOpen('chute', world.snapshot(drainTicks * 3 + 3))).toBe(false);

    // Leaving and making a new touch is what permits a later batch to open.
    world.moveRobot(null);
    conveyors.update(world.snapshot(drainTicks * 3 + 4), drainTicks * 3 + 4, world);
    positions.set('d', inEntry(0));
    conveyors.update(world.snapshot(drainTicks * 3 + 5), drainTicks * 3 + 5, world);
    world.moveRobot(gate);
    expect(conveyors.isOpen('chute', world.snapshot(drainTicks * 3 + 6))).toBe(true);
  });

  it('retracts a declared live gate for an indexed queue, then closes it after the final release', () => {
    const indexed: PieceConveyorSpec = { ...SPEC, gateColliderTag: 'indexed-gate' };
    const positions = new Map(['a', 'b'].map((id, index) => [id, inEntry(index)] as const));
    const gate = vec2(0, -20 * 0.0254);
    const world = new FakeWorld(positions, gate);
    const conveyors = new PieceConveyors([indexed], places(indexed), DT);

    conveyors.update(world.snapshot(0), 0, world);
    expect(world.colliderStates.get('indexed-gate')).toBe(false);

    // Its trigger robot still overlaps the zone, but gravity closes the field
    // gate after the last indexed ball has left.
    const drainTicks = Math.round(indexed.drainIntervalSec / DT);
    conveyors.update(world.snapshot(drainTicks), drainTicks, world);
    expect(conveyors.queued('chute')).toEqual([]);
    expect(world.colliderStates.get('indexed-gate')).toBe(true);
  });

  it('drains in arrival order, way-out end first', () => {
    const drainTicks = Math.round(SPEC.drainIntervalSec / DT);
    const { conveyors } = run(['a', 'b', 'c'], 10 + drainTicks, { openAt: 10 });

    // One gone by the time the second interval is due, and it is the one that
    // arrived first.
    expect(conveyors.queued('chute')).toEqual(['b', 'c']);
  });

  /** Gate activation is not instantaneous: it releases a controlled train. */
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

    // A gate only opens to release a real, already-arrived piece.
    conveyors.update(closed.snapshot(0), 0, closed);

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

describe('one-way exits', () => {
  it('rejects a loose piece from every public edge of a declared one-way exit', () => {
    const oneWay: PieceConveyorSpec = { ...SPEC, blocksInboundExit: true };
    const publicMouth = farEndOf(EXIT, QUEUE.centerM);
    const positions = new Map([['intruder', publicMouth]]);
    const world = new FakeWorld(positions);
    const conveyors = new PieceConveyors([oneWay], places(oneWay), DT);

    const snapshot = world.snapshot(0);
    const piece = snapshot.pieces[0];
    if (piece === undefined) throw new Error('piece missing');
    conveyors.update(snapshot, 0, world);

    expect(world.blocked.get('intruder')).toBeDefined();
    // An unauthorised ball is stopped one whole radius beyond its own edge;
    // it never gets close enough to touch an open GATE passage.
    expect(world.blocked.get('intruder')?.y ?? -Infinity).toBeLessThan(publicMouth.y - 0.06223 * 2);

    // A ball pushed through the long field-facing wall is blocked too. This
    // is the path a velocity-only check missed when a live gate was open.
    const sideIntruder = new FakeWorld(new Map([['side', vec2(EXIT.centerM.x + inchesToMeters(1), EXIT.centerM.y)]]));
    conveyors.update(sideIntruder.snapshot(1), 1, sideIntruder);
    expect(sideIntruder.blocked.get('side')).toBeDefined();
    expect(sideIntruder.blocked.get('side')?.x ?? -Infinity)
      .toBeGreaterThan(EXIT.centerM.x + inchesToMeters(4) + 0.06223 * 2);
  });

  it('does not block a piece the conveyor itself released', () => {
    const oneWay: PieceConveyorSpec = { ...SPEC, blocksInboundExit: true };
    const { world } = run(['a'], 15, { spec: oneWay, openAt: 10 });
    expect(world.released.has('a')).toBe(true);
    expect(world.blocked.has('a')).toBe(false);
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

  it('uses a declared pitch to keep identical pieces end-to-end from the exit end', () => {
    const pitch = inchesToMeters(5);
    const first = queuePoint(QUEUE, 9, 0, pitch);
    const second = queuePoint(QUEUE, 9, 1, pitch);
    const ninth = queuePoint(QUEUE, 9, 8, pitch);

    expect(second.y - first.y).toBeCloseTo(pitch, 8);
    expect(ninth.y - first.y).toBeCloseTo(pitch * 8, 8);
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
