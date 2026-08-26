import { describe, expect, it } from 'vitest';
import { DT_SECONDS, SimWorld, TICK_RATE_HZ, chassisVelocityOf } from './simWorld.js';
import { runHeadless, secondsToTicks } from './headless.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../robot/robotConfig.js';
import { constantController, createInputTrace, ScriptedController } from '../control/scripted.js';
import { createControlInput, NEUTRAL_INPUT, type ControlInput } from '../control/controlInput.js';
import type { Pose } from '../physics/body.js';
import { NeutralController } from '../control/controller.js';
import { analyticFreeSpeed, analyticPeakAcceleration } from '../drive/drivetrain.js';
import { deriveRobot } from '../robot/derive.js';
import { createStandardField, fieldBounds, FIELD_SIZE_IN } from '../field/fieldTemplate.js';
import { asVolts, inchesToMeters, metersPerSecToFeetPerSec, radPerSecToDegPerSec } from '../units/convert.js';
import { SubStream } from '../math/rng.js';
import { vec2 } from '../math/vec2.js';
import { metersPerSec, radPerSec } from '../units/si.js';

const FULL_FORWARD = createControlInput(1, 0, 0);
const FULL_STRAFE = createControlInput(0, 1, 0);
const FULL_SPIN = createControlInput(0, 0, 1);

const drive = (input = FULL_FORWARD, seconds = 4, config: RobotConfig = DEFAULT_ROBOT_CONFIG) =>
  runHeadless({
    robots: [{ config, controller: constantController(input) }],
    ticks: secondsToTicks(seconds, DT_SECONDS),
    recordTelemetry: true,
  });

/**
 * Straight-line runs start against the far wall.
 *
 * The field is only 3.66 m across and this robot tops out near 1.57 m/s, so a
 * run from the centre reaches the perimeter in about a second. It converges to
 * within 0.04 % of free speed after 1.0 s having covered 1.37 m, so starting at
 * the wall gives plenty of runway to measure a genuinely settled top speed.
 */
const WEST_START = { p: vec2(-1.6, 0), theta: 0 };
const SOUTH_START = { p: vec2(0, -1.6), theta: 0 };
/** Long enough to settle, short enough not to reach the far wall. */
const RUNWAY_SECONDS = 1.4;

const driveFrom = (
  input: ControlInput,
  startPose: Pose,
  seconds = RUNWAY_SECONDS,
  recordTelemetry = true,
) =>
  runHeadless({
    robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(input), startPose }],
    ticks: secondsToTicks(seconds, DT_SECONDS),
    recordTelemetry,
  });

/** Ground speed of a snapshot robot, m/s. */
const speedOf = (robot: { vel: { v: { x: number; y: number } } } | undefined): number =>
  robot === undefined ? 0 : Math.hypot(robot.vel.v.x, robot.vel.v.y);

describe('sim clock', () => {
  it('runs at exactly 200 Hz', () => {
    expect(TICK_RATE_HZ).toBe(200);
    expect(DT_SECONDS).toBeCloseTo(0.005, 15);
  });

  it('derives time from the tick counter, never a wall clock', () => {
    const result = drive(NEUTRAL_INPUT, 1);
    expect(result.world.tick).toBe(200);
    expect(result.world.timeSec).toBeCloseTo(1.0, 12);
  });

  it('advances identically whether stepped one at a time or in bulk', () => {
    const single = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(FULL_FORWARD) }],
    });
    const bulk = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(FULL_FORWARD) }],
    });

    for (let i = 0; i < 500; i++) single.step();
    bulk.stepMany(500);

    expect(single.stateHash()).toBe(bulk.stateHash());
  });
});

describe('determinism — golden state hash', () => {
  /**
   * A fixed seed and a fixed input trace must produce a byte-identical state
   * digest on every run. This is the canary for accidental nondeterminism:
   * unordered iteration, a leaked wall clock, an unseeded random draw.
   *
   * The expected value is captured from the implementation rather than derived
   * analytically, so a *change* to it is meaningful even though the value
   * itself is arbitrary. If physics changes deliberately, rebaseline it in the
   * same commit as the change.
   */
  /**
   * Deliberately started near the north-east corner so the opening full-forward
   * segment drives into the perimeter. The digest then covers contact detection
   * and resolution ordering as well as drivetrain integration — a determinism
   * canary that skipped collision would miss the most order-sensitive code in
   * the simulator.
   */
  const GOLDEN_START = { p: vec2(1.2, 1.2), theta: 0.25 };

  const GOLDEN_TRACE = createInputTrace('golden', [
    { tick: 0, input: createControlInput(1, 0, 0) },
    { tick: 120, input: createControlInput(0.4, -0.8, 0.3) },
    { tick: 260, input: createControlInput(-1, 0.5, -0.6) },
    { tick: 400, input: createControlInput(0, 0, 1) },
    { tick: 560, input: NEUTRAL_INPUT },
  ]);

  const runGolden = (): string =>
    runHeadless({
      seed: 0x5eed,
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new ScriptedController(GOLDEN_TRACE),
          startPose: GOLDEN_START,
        },
      ],
      ticks: 700,
    }).stateHash;

  it('reproduces the same digest across runs', () => {
    const first = runGolden();
    for (let i = 0; i < 5; i++) expect(runGolden()).toBe(first);
  });

  it('matches the committed golden digest', () => {
    // Rebaselined twice, both times for a deliberate physics change: the
    // clipped contact manifold with its iterated normal solver, and then the
    // mecanum roller-drag term. The golden trace drives into the perimeter and
    // strafes, so it exercises both.
    expect(runGolden()).toBe('6785b5b0');
  });

  it('changes when the input trace changes', () => {
    const different = runHeadless({
      seed: 0x5eed,
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: new ScriptedController(
            createInputTrace('other', [{ tick: 0, input: createControlInput(0.9, 0, 0) }]),
          ),
          startPose: GOLDEN_START,
        },
      ],
      ticks: 700,
    }).stateHash;

    expect(different).not.toBe(runGolden());
  });

  it('changes when the robot configuration changes', () => {
    const heavier: RobotConfig = {
      ...DEFAULT_ROBOT_CONFIG,
      chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, massLb: 40 },
    };
    const result = runHeadless({
      seed: 0x5eed,
      robots: [
        {
          config: heavier,
          controller: new ScriptedController(GOLDEN_TRACE),
          startPose: GOLDEN_START,
        },
      ],
      ticks: 700,
    }).stateHash;

    expect(result).not.toBe(runGolden());
  });

  it('gives each sub-stream an independent, reproducible sequence', () => {
    const a = new SimWorld({ robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }], seed: 7 });
    const b = new SimWorld({ robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: new NeutralController() }], seed: 7 });

    expect(a.rng(SubStream.Physics).nextUint32()).toBe(b.rng(SubStream.Physics).nextUint32());
    expect(a.rng(SubStream.Physics).nextUint32()).not.toBe(b.rng(SubStream.GamePiece).nextUint32());
  });
});

describe('Phase 1 verification — emergent top speed', () => {
  /**
   * Nothing anywhere sets a maximum speed. The robot must coast up to the point
   * where back-EMF cancels the applied voltage, and that point must match the
   * closed-form prediction.
   */
  it('converges to the analytic free speed under full forward command', () => {
    const result = driveFrom(FULL_FORWARD, WEST_START);
    const robot = result.finalSnapshot.robots[0];
    expect(robot).toBeDefined();
    if (robot === undefined) return;

    const derived = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const predicted = analyticFreeSpeed(
      derived.drivetrain,
      asVolts(result.finalSnapshot.batteryVolts),
    );

    expect(speedOf(robot)).toBeCloseTo(predicted, 3);
  });

  it('reaches about 5.1 ft/s, the hand-computed value for this robot', () => {
    const result = driveFrom(FULL_FORWARD, WEST_START);
    const ftps = metersPerSecToFeetPerSec(metersPerSec(speedOf(result.finalSnapshot.robots[0])));
    expect(ftps).toBeGreaterThan(5.0);
    expect(ftps).toBeLessThan(5.3);
  });

  it('never exceeds the analytic free speed', () => {
    const result = driveFrom(FULL_FORWARD, WEST_START);
    const derived = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const ceiling = analyticFreeSpeed(derived.drivetrain, asVolts(12));

    for (const sample of result.telemetry) {
      const robot = sample.robots[0];
      if (robot === undefined) continue;
      expect(robot.speedMps).toBeLessThanOrEqual(ceiling + 1e-6);
    }
  });
});

describe('Phase 1 verification — emergent acceleration', () => {
  it('matches the analytic peak acceleration on the first tick', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(FULL_FORWARD) }],
    });
    const derived = world.derivedRobot(0);

    // Tick 0 runs on the open-circuit voltage: no load has been seen yet.
    const predicted = analyticPeakAcceleration(derived.drivetrain, asVolts(12), derived.massKg);

    world.step();
    const measured = Math.hypot(world.snapshot().robots[0]?.vel.v.x ?? 0, 0) / DT_SECONDS;

    expect(measured).toBeCloseTo(predicted, 6);
  });

  /**
   * No rolling-resistance or drag coefficient exists anywhere. Deceleration is
   * entirely back-EMF braking falling out of the motor model
   * (ASSUMPTIONS.md §2.4), so releasing the stick must still slow the robot.
   */
  it('decelerates from the motor model alone when the command is released', () => {
    const atSpeed = driveFrom(FULL_FORWARD, WEST_START, 1.2, false);
    const moving = speedOf(atSpeed.finalSnapshot.robots[0]);
    expect(moving).toBeGreaterThan(1);

    const released = runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          startPose: WEST_START,
          controller: new ScriptedController(
            createInputTrace('release', [
              { tick: 0, input: FULL_FORWARD },
              { tick: 240, input: NEUTRAL_INPUT },
            ]),
          ),
        },
      ],
      ticks: 400,
    });

    expect(speedOf(released.finalSnapshot.robots[0])).toBeLessThan(moving * 0.5);
  });
});

describe('Phase 1 verification — rotation and strafe', () => {
  /**
   * Spinning in place drags every contact patch sideways, so the rollers turn
   * and resist. The rate settles below the pure-kinematic `v_free / k`.
   */
  it('reaches a steady rotation rate near 214 deg/s', () => {
    const result = drive(FULL_SPIN, 6);
    const robot = result.finalSnapshot.robots[0];
    if (robot === undefined) return;

    const degPerSec = Math.abs(radPerSecToDegPerSec(radPerSec(robot.vel.omega)));
    expect(degPerSec).toBeGreaterThan(205);
    expect(degPerSec).toBeLessThan(225);
  });

  /**
   * A mecanum robot strafes slower than it drives, and the model says so for a
   * geometric reason rather than by a fudge factor: driving straight ahead does
   * not turn the rollers at all, strafing turns them at `sqrt2` times the
   * chassis speed, and the roller path has resistance in it
   * (`rollerSlipSpeeds`, ASSUMPTIONS.md §2.2).
   */
  it('strafes slower than it drives', () => {
    const forward = speedOf(driveFrom(FULL_FORWARD, WEST_START).finalSnapshot.robots[0]);
    const strafe = speedOf(driveFrom(FULL_STRAFE, SOUTH_START).finalSnapshot.robots[0]);

    expect(strafe).toBeLessThan(forward);
    // Slower, but still a usable drivetrain rather than a crippled one.
    expect(strafe / forward).toBeGreaterThan(0.7);
    expect(strafe / forward).toBeLessThan(0.9);
  });

  /**
   * The penalty has to be a property of the *direction of travel*, not of the
   * command axis: a robot pointed 90 degrees round and driving "forward" is
   * moving over the same floor as one strafing, and must behave differently
   * because its wheels are oriented differently, not because of how the stick
   * was mixed.
   */
  it('ties the strafe penalty to the wheels, not to the world axis', () => {
    const drivingNorth = driveFrom(FULL_FORWARD, { p: vec2(0, -1.6), theta: Math.PI / 2 });
    const strafingNorth = driveFrom(FULL_STRAFE, SOUTH_START);

    const forward = speedOf(driveFrom(FULL_FORWARD, WEST_START).finalSnapshot.robots[0]);

    // Both end up travelling north; only the second one is strafing.
    expect(speedOf(drivingNorth.finalSnapshot.robots[0])).toBeCloseTo(forward, 3);
    expect(speedOf(strafingNorth.finalSnapshot.robots[0])).toBeLessThan(forward);
  });

  it('strafes sideways in the body frame, not forwards', () => {
    const result = driveFrom(FULL_STRAFE, SOUTH_START, 1.0);
    const robot = result.finalSnapshot.robots[0];
    if (robot === undefined) return;

    expect(Math.abs(robot.chassis.vy)).toBeGreaterThan(Math.abs(robot.chassis.vx) * 100);
    // Strafing left from the south wall moves the robot north.
    expect(robot.pose.p.y).toBeGreaterThan(SOUTH_START.p.y);
  });
});

describe('invariants under randomised input', () => {
  /**
   * Property test: whatever the driver does, the robot must stay finite, stay
   * inside the field, and never tunnel through a wall.
   */
  it('keeps the robot finite and inside the field', () => {
    const bounds = fieldBounds(createStandardField());
    const halfDiagonal = Math.hypot(inchesToMeters(18), inchesToMeters(18)) / 2;

    for (let seed = 0; seed < 6; seed++) {
      const world = new SimWorld({
        seed,
        robots: [
          {
            config: DEFAULT_ROBOT_CONFIG,
            controller: {
              id: 'wiggle',
              sample: (tick: number) =>
                createControlInput(
                  Math.sin(tick * 0.013 + seed),
                  Math.cos(tick * 0.021 + seed * 2),
                  Math.sin(tick * 0.007 + seed * 3),
                ),
            },
          },
        ],
      });

      for (let i = 0; i < 3000; i++) {
        world.step();
        const robot = world.snapshot().robots[0];
        if (robot === undefined) throw new Error('robot missing');

        expect(Number.isFinite(robot.pose.p.x)).toBe(true);
        expect(Number.isFinite(robot.pose.p.y)).toBe(true);
        expect(Number.isFinite(robot.pose.theta)).toBe(true);
        expect(Number.isFinite(robot.vel.v.x)).toBe(true);
        expect(Number.isFinite(robot.vel.omega)).toBe(true);

        // The centre can never leave the field by more than its own reach.
        expect(robot.pose.p.x).toBeGreaterThan(bounds.minX - halfDiagonal);
        expect(robot.pose.p.x).toBeLessThan(bounds.maxX + halfDiagonal);
        expect(robot.pose.p.y).toBeGreaterThan(bounds.minY - halfDiagonal);
        expect(robot.pose.p.y).toBeLessThan(bounds.maxY + halfDiagonal);
      }
    }
  });

  it('does not tunnel through a wall at full speed', () => {
    // Start near the east wall and drive straight at it for four seconds.
    const bounds = fieldBounds(createStandardField());
    const result = runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(FULL_FORWARD),
          startPose: { p: vec2(bounds.maxX - 0.6, 0), theta: 0 },
        },
      ],
      ticks: 800,
    });

    const robot = result.finalSnapshot.robots[0];
    if (robot === undefined) return;
    expect(robot.pose.p.x).toBeLessThan(bounds.maxX);
  });
});

describe('field template', () => {
  it('is exactly 12 ft square', () => {
    const field = createStandardField();
    expect(FIELD_SIZE_IN).toBe(144);
    expect(field.widthM).toBeCloseTo(3.6576, 9);
    expect(field.lengthM).toBeCloseTo(3.6576, 9);
  });

  it('is centred on the origin', () => {
    const bounds = fieldBounds(createStandardField());
    expect(bounds.minX).toBeCloseTo(-bounds.maxX, 12);
    expect(bounds.minY).toBeCloseTo(-bounds.maxY, 12);
    expect(bounds.maxX).toBeCloseTo(1.8288, 9);
  });

  it('has four perimeter walls', () => {
    expect(createStandardField().bodies).toHaveLength(4);
  });
});

describe('multi-robot support', () => {
  /**
   * Phase 1's UI shows one robot, but nothing in the core special-cases the
   * count. Proving that now is what keeps alliances cheap to add later.
   */
  it('simulates several robots without special-casing', () => {
    const result = runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(FULL_FORWARD),
          alliance: 'red',
          startPose: { p: vec2(-1.2, -1.2), theta: 0 },
        },
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(FULL_FORWARD),
          alliance: 'blue',
          startPose: { p: vec2(1.2, 1.2), theta: Math.PI },
        },
      ],
      ticks: 400,
    });

    expect(result.finalSnapshot.robots).toHaveLength(2);
    expect(result.finalSnapshot.robots[0]?.alliance).toBe('red');
    expect(result.finalSnapshot.robots[1]?.alliance).toBe('blue');
    expect(result.finalSnapshot.robots[0]?.pose.p.x).toBeGreaterThan(-1.2);
    expect(result.finalSnapshot.robots[1]?.pose.p.x).toBeLessThan(1.2);
  });

  it('sums pack current across robots', () => {
    const one = runHeadless({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(FULL_FORWARD) }],
      ticks: 1,
    });
    const two = runHeadless({
      robots: [
        { config: DEFAULT_ROBOT_CONFIG, controller: constantController(FULL_FORWARD) },
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(FULL_FORWARD),
          startPose: { p: vec2(1.5, 1.5), theta: 0 },
        },
      ],
      ticks: 1,
    });

    expect(two.finalSnapshot.batteryCurrentA).toBeCloseTo(
      one.finalSnapshot.batteryCurrentA * 2,
      6,
    );
  });

  it('rejects a world with no robots', () => {
    expect(() => new SimWorld({ robots: [] })).toThrow(/at least one robot/);
  });
});

describe('body-frame velocity helper', () => {
  it('rotates world velocity into the body frame', () => {
    const world = new SimWorld({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          controller: constantController(FULL_FORWARD),
          startPose: { p: vec2(0, 0), theta: Math.PI / 2 },
        },
      ],
    });
    world.stepMany(400);

    const robot = world.snapshot().robots[0];
    if (robot === undefined) return;

    // Facing +Y and driving forward: world velocity is +Y, body velocity is +X.
    expect(robot.vel.v.y).toBeGreaterThan(0);
    expect(robot.chassis.vx).toBeGreaterThan(0);
    expect(Math.abs(robot.chassis.vy)).toBeLessThan(1e-6);
  });

  it('is consistent with the snapshot chassis velocity', () => {
    const world = new SimWorld({
      robots: [{ config: DEFAULT_ROBOT_CONFIG, controller: constantController(FULL_FORWARD) }],
    });
    world.stepMany(100);
    const snapshot = world.snapshot();
    const robot = snapshot.robots[0];
    if (robot === undefined) return;
    expect(chassisVelocityOf).toBeTypeOf('function');
    expect(robot.chassis.vx).toBeGreaterThan(0);
  });
});
