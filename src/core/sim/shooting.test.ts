/**
 * Ball flight and shooting.
 *
 * A launched piece leaves the plane the rest of the simulator lives in, so its
 * height is integrated separately (`physics/ballistics.ts`). With no drag the
 * horizontal and vertical components of projectile motion are independent, so
 * that split is exact — and closed-form range and apex exist to measure the
 * integration against, the way `analyticFreeSpeed` backs the drivetrain.
 */

import { describe, expect, it } from 'vitest';
import { DT_SECONDS, SimWorld, type GamePieceSpec } from './simWorld.js';
import { LAUNCH_BUTTON, aimShot, launcherOf } from './launcher.js';
import { analyticApex, analyticRange, stepVertical } from '../physics/ballistics.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../robot/robotConfig.js';
import { constantController } from '../control/scripted.js';
import { createControlInput } from '../control/controlInput.js';
import { NeutralController } from '../control/controller.js';
import { deriveRobot } from '../robot/derive.js';
import { Pcg32, SubStream } from '../math/rng.js';
import { degreesToRadians, inchesToMeters, STANDARD_GRAVITY } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';
import type { Capability } from '../mechanism/capability.js';

/** No perimeter, so a shot measures a trajectory rather than a wall. */
const OPEN_FIELD: FieldTemplate = {
  id: 'open',
  name: 'No perimeter',
  widthM: 1000,
  lengthM: 1000,
  bodies: [],
};

const ARTIFACT_DIAMETER_IN = 4.9;
const ARTIFACT_RADIUS_M = inchesToMeters(ARTIFACT_DIAMETER_IN) / 2;

const artifact = (pieceId: string, xIn: number, yIn: number): GamePieceSpec => ({
  pieceId,
  pieceType: 'P',
  diameterIn: ARTIFACT_DIAMETER_IN,
  massLb: 0.165,
  startPositionM: vec2(inchesToMeters(xIn), inchesToMeters(yIn)),
});

const SHOOTER: Capability = {
  kind: 'launch',
  pieceTypes: [],
  exitSpeedFtPerSec: 30,
  exitAngleDeg: 45,
  spreadDeg: 0,
};

const shooterRobot = (overrides: Partial<Capability> = {}): RobotConfig => ({
  ...DEFAULT_ROBOT_CONFIG,
  mechanisms: [
    {
      id: 'shooter',
      name: 'Shooter',
      preset: 'shooter',
      massLb: 6,
      mount: { xIn: 9, yIn: 0, facingDeg: 0 },
      actuation: { motorId: 'gobilda-5203-312', motorCount: 2, gearRatio: 1, efficiency: 0.95 },
      capabilities: [{ ...SHOOTER, ...overrides } as Capability],
    },
  ],
});

describe('a piece falls under gravity', () => {
  it('accelerates downward at g', () => {
    const start = { heightM: 2, velocityMps: 0 };
    const after = stepVertical(start, ARTIFACT_RADIUS_M, DT_SECONDS);

    expect(after.state.velocityMps).toBeCloseTo(-STANDARD_GRAVITY * DT_SECONDS, 12);
    expect(after.landed).toBe(false);
  });

  it('comes to rest on the floor at one radius, and stays', () => {
    let state = { heightM: 2, velocityMps: 0 };
    for (let i = 0; i < 400; i++) state = stepVertical(state, ARTIFACT_RADIUS_M, DT_SECONDS).state;

    expect(state.heightM).toBeCloseTo(ARTIFACT_RADIUS_M, 12);
    expect(state.velocityMps).toBe(0);
  });

  /** Restitution is zero everywhere in this simulator (ASSUMPTIONS.md §5.1). */
  it('does not bounce', () => {
    const landing = stepVertical({ heightM: ARTIFACT_RADIUS_M, velocityMps: -3 }, ARTIFACT_RADIUS_M, DT_SECONDS);
    expect(landing.state.velocityMps).toBe(0);
    expect(landing.landed).toBe(true);
  });

  it('reports a piece resting on the floor as not airborne', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [artifact('a1', 20, 0)],
      field: OPEN_FIELD,
    });
    world.stepMany(20);

    const piece = world.snapshot().pieces[0];
    expect(piece?.airborne).toBe(false);
    expect(piece?.heightM).toBeCloseTo(ARTIFACT_RADIUS_M, 6);
  });
});

describe('a launched piece follows the analytic trajectory', () => {
  const launchAndTrack = (speedMps: number, elevationDeg: number) => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [artifact('a1', 0, 40)],
      field: OPEN_FIELD,
      seed: 1,
    });

    // Launched from the floor so the closed-form range applies directly.
    world.launchPiece('a1', {
      speedMps,
      elevationRad: degreesToRadians(elevationDeg),
      headingRad: 0,
      fromHeightM: ARTIFACT_RADIUS_M,
    });

    const startX = world.snapshot().pieces[0]?.pose.p.x ?? 0;
    let apex = 0;
    for (let i = 0; i < 2000; i++) {
      world.step();
      const piece = world.snapshot().pieces[0];
      if (piece === undefined) break;
      apex = Math.max(apex, piece.heightM);
      if (!piece.airborne && i > 2) break;
    }

    const landed = world.snapshot().pieces[0];
    return { range: (landed?.pose.p.x ?? 0) - startX, apex: apex - ARTIFACT_RADIUS_M };
  };

  it('carries the textbook range', () => {
    for (const [speed, angle] of [
      [8, 45],
      [8, 30],
      [12, 40],
    ] as const) {
      const { range } = launchAndTrack(speed, angle);
      const predicted = analyticRange(speed, degreesToRadians(angle));

      // Within a tick of travel: the integration lands on a fixed grid, so the
      // last step overshoots the floor by at most one step of horizontal motion.
      expect(Math.abs(range - predicted)).toBeLessThan(speed * DT_SECONDS * 2);
    }
  });

  it('reaches the textbook apex', () => {
    for (const [speed, angle] of [
      [8, 45],
      [10, 60],
    ] as const) {
      const { apex } = launchAndTrack(speed, angle);
      const predicted = analyticApex(speed, degreesToRadians(angle));

      /**
       * Semi-implicit Euler undershoots the peak by exactly half a step of the
       * launch's vertical speed — the same half-step offset the planar
       * integrator carries (`physics.test.ts`, "the position offset
       * characteristic of the symplectic form"). Asserting the identity rather
       * than a tolerance pins the integrator, not just the answer.
       */
      const verticalMps = speed * Math.sin(degreesToRadians(angle));
      expect(predicted - apex).toBeCloseTo((verticalMps * DT_SECONDS) / 2, 3);
    }
  });

  it('throws further at 45 degrees than either side of it', () => {
    const flat = launchAndTrack(9, 25).range;
    const best = launchAndTrack(9, 45).range;
    const steep = launchAndTrack(9, 65).range;

    expect(best).toBeGreaterThan(flat);
    expect(best).toBeGreaterThan(steep);
  });

  it('keeps its horizontal velocity the whole way, having no drag', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [artifact('a1', 0, 40)],
      field: OPEN_FIELD,
    });
    world.launchPiece('a1', { speedMps: 9, elevationRad: degreesToRadians(45), headingRad: 0 });

    const initial = world.snapshot().pieces[0]?.vel.v.x ?? 0;
    world.stepMany(30);
    expect(world.snapshot().pieces[0]?.vel.v.x).toBeCloseTo(initial, 9);
  });

  it('flies in the direction it was aimed', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [artifact('a1', 0, 0)],
      field: OPEN_FIELD,
    });
    world.launchPiece('a1', {
      speedMps: 9,
      elevationRad: degreesToRadians(45),
      headingRad: Math.PI / 2,
    });
    world.stepMany(30);

    const piece = world.snapshot().pieces[0];
    expect(piece?.pose.p.y).toBeGreaterThan(0);
    expect(Math.abs(piece?.pose.p.x ?? 1)).toBeLessThan(1e-9);
  });

  it('refuses a negative launch speed rather than flying backwards', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }],
      pieces: [artifact('a1', 0, 0)],
    });
    expect(() =>
      world.launchPiece('a1', { speedMps: -1, elevationRad: 0, headingRad: 0 }),
    ).toThrow(/non-negative/);
    expect(() => world.launchPiece('nope', { speedMps: 1, elevationRad: 0, headingRad: 0 })).toThrow(
      /No game piece/,
    );
  });
});

/**
 * The reason height was already modelled: bodies only collide when their
 * vertical spans overlap, which was written for a robot driving under a raised
 * element and is what makes a ball fly *over* a robot.
 */
describe('a piece in flight clears what it passes over', () => {
  it('passes over a robot instead of hitting it', () => {
    const world = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new NeutralController(),
          startPose: { p: vec2(inchesToMeters(40), 0), theta: 0 },
        },
      ],
      pieces: [artifact('a1', 0, 0)],
      field: OPEN_FIELD,
    });

    // Steep and fast enough to be well above an 18 in robot as it crosses.
    world.launchPiece('a1', {
      speedMps: 10,
      elevationRad: degreesToRadians(55),
      headingRad: 0,
      fromHeightM: inchesToMeters(18),
    });

    let clearedTheRobot = false;
    for (let i = 0; i < 400; i++) {
      world.step();
      const piece = world.snapshot().pieces[0];
      if (piece === undefined) break;
      if (piece.pose.p.x > inchesToMeters(50)) {
        clearedTheRobot = true;
        break;
      }
    }

    expect(clearedTheRobot).toBe(true);
    // Straight through, never deflected sideways by a collision it should not
    // have had.
    expect(Math.abs(world.snapshot().pieces[0]?.pose.p.y ?? 1)).toBeLessThan(1e-6);
  });

  it('still collides with a robot when it is rolling on the floor', () => {
    const world = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new NeutralController(),
          startPose: { p: vec2(inchesToMeters(40), 0), theta: 0 },
        },
      ],
      pieces: [artifact('a1', 0, 0)],
      field: OPEN_FIELD,
    });

    // Flat and low: it never leaves the floor, so it must be stopped.
    world.launchPiece('a1', { speedMps: 4, elevationRad: 0, headingRad: 0 });
    world.stepMany(400);

    const piece = world.snapshot().pieces[0];
    // Robot's leading face is at 40 - 9 = 31 in.
    expect(piece?.pose.p.x).toBeLessThan(inchesToMeters(31));
  });
});

describe('a robot shoots what it is holding', () => {
  const fireAt = (pieceXIn: number, config = shooterRobot()) => {
    const world = new SimWorld({
      robots: [
        {
          config,
          controller: constantController(
            createControlInput(0, 0, 0, { [LAUNCH_BUTTON]: true }),
          ),
          startPose: { p: vec2(0, 0), theta: 0 },
        },
      ],
      pieces: [artifact('a1', pieceXIn, 0)],
      field: OPEN_FIELD,
      seed: 1,
    });
    world.step();
    return world;
  };

  it('finds the launch capability the robot was built with', () => {
    expect(launcherOf(deriveRobot(shooterRobot()).mechanisms)).toBeDefined();
    expect(launcherOf(deriveRobot(DEFAULT_ROBOT_CONFIG).mechanisms)).toBeUndefined();
  });

  it('launches a loaded piece when the button is pressed', () => {
    // Robot half-length is 9 in, so a piece at 11 in is against its face.
    const world = fireAt(11.5);
    const piece = world.snapshot().pieces[0];

    expect(piece?.airborne).toBe(true);
    expect(piece?.verticalVelocityMps).toBeGreaterThan(0);
  });

  it('does nothing when there is no piece loaded', () => {
    const world = fireAt(60);
    const piece = world.snapshot().pieces[0];

    expect(piece?.airborne).toBe(false);
    expect(Math.hypot(piece?.vel.v.x ?? 0, piece?.vel.v.y ?? 0)).toBeCloseTo(0, 9);
  });

  it('does nothing when the robot has no launcher', () => {
    const world = fireAt(11.5, DEFAULT_ROBOT_CONFIG);
    expect(world.snapshot().pieces[0]?.airborne).toBe(false);
  });

  it('will not launch a piece type its shooter does not take', () => {
    const world = fireAt(11.5, shooterRobot({ pieceTypes: ['G'] }));
    expect(world.snapshot().pieces[0]?.airborne).toBe(false);
  });

  it('throws in the direction the robot is facing', () => {
    const world = new SimWorld({
      robots: [
        {
          config: shooterRobot(),
          controller: constantController(createControlInput(0, 0, 0, { [LAUNCH_BUTTON]: true })),
          startPose: { p: vec2(0, 0), theta: Math.PI / 2 },
        },
      ],
      // In front of a robot facing +Y.
      pieces: [artifact('a1', 0, 11.5)],
      field: OPEN_FIELD,
      seed: 1,
    });
    world.stepMany(20);

    const piece = world.snapshot().pieces[0];
    expect(piece?.vel.v.y).toBeGreaterThan(1);
    expect(Math.abs(piece?.vel.v.x ?? 1)).toBeLessThan(0.01);
  });
});

describe('shooter accuracy', () => {
  const capability = { ...SHOOTER, spreadDeg: 10 } as Capability & { kind: 'launch' };

  it('aims exactly where it is pointed with no spread', () => {
    const rng = new Pcg32(1, SubStream.Launch);
    const shot = aimShot({ ...capability, spreadDeg: 0 }, 1.234, 0.4, rng);
    expect(shot.headingRad).toBe(1.234);
  });

  it('keeps the error inside the cone it declares', () => {
    const rng = new Pcg32(7, SubStream.Launch);
    const half = degreesToRadians(capability.spreadDeg / 2);

    for (let i = 0; i < 200; i++) {
      const shot = aimShot(capability, 0, 0.4, rng);
      expect(Math.abs(shot.headingRad)).toBeLessThanOrEqual(half + 1e-12);
    }
  });

  it('converts the exit speed out of feet per second', () => {
    const rng = new Pcg32(1, SubStream.Launch);
    const shot = aimShot(capability, 0, 0.4, rng);
    expect(shot.speedMps).toBeCloseTo(30 * 0.3048, 9);
    expect(shot.elevationRad).toBeCloseTo(degreesToRadians(45), 12);
  });

  /** Same seed, same shots — a replay has to reproduce a match exactly. */
  it('is deterministic under a seed', () => {
    const play = (): string => {
      const rng = new Pcg32(99, SubStream.Launch);
      return [0, 1, 2, 3, 4].map(() => aimShot(capability, 0, 0.4, rng).headingRad).join(',');
    };
    expect(play()).toBe(play());
  });
});
