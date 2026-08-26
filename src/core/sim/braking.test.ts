/**
 * Regression: releasing the controls stops the robot, on every axis.
 *
 * The goBILDA motors are modelled as zero-power **BRAKE** (ASSUMPTIONS.md §2.4),
 * and the braking comes out of the motor model rather than from a drag term: at
 * `duty = 0` the terminal voltage is zero, so the winding sees only back-EMF and
 * the shaft torque is `-k_t k_e omega / R`. Two consequences are asserted below
 * because they are what distinguishes a real brake from a fudge factor:
 *
 *   - Deceleration on release from free speed equals *peak acceleration from
 *     rest*. At free speed the back-EMF is the full pack voltage, so a shorted
 *     motor draws exactly stall current in reverse. Nothing can brake harder
 *     than that without inventing a force the motor cannot produce.
 *
 *   - The robot keeps moving a little. Velocity is never assigned zero anywhere
 *     in the simulator, so a released robot decelerates through a physical
 *     curve; a test that only checked "stops" would pass against a hard reset.
 */

import { describe, expect, it } from 'vitest';
import { DT_SECONDS, SimWorld } from './simWorld.js';
import { runHeadless } from './headless.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { createInputTrace, ScriptedController } from '../control/scripted.js';
import { createControlInput, NEUTRAL_INPUT, type ControlInput } from '../control/controlInput.js';
import { analyticPeakAcceleration } from '../drive/drivetrain.js';
import { deriveRobot } from '../robot/derive.js';
import { asVolts } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { Pose } from '../physics/body.js';
import type { RobotSnapshot } from './snapshot.js';

const FULL_FORWARD = createControlInput(1, 0, 0);
const FULL_STRAFE = createControlInput(0, 1, 0);
const FULL_SPIN = createControlInput(0, 0, 1);

/** 1.5 s of command, long enough for this robot to settle at free speed. */
const SPIN_UP_TICKS = 300;

/**
 * Start poses that leave a full stopping distance of clear floor ahead.
 *
 * The field is 3.66 m across and the robot needs about 1.4 m of runway plus
 * 0.2 m of stopping distance, so a run that started at the centre would reach
 * the perimeter and measure a wall rather than a brake.
 */
const WEST_START: Pose = { p: vec2(-1.5, 0), theta: 0 };
const SOUTH_START: Pose = { p: vec2(0, -1.5), theta: 0 };
const CENTRE: Pose = { p: vec2(0, 0), theta: 0 };

const speedOf = (robot: RobotSnapshot): number => Math.hypot(robot.vel.v.x, robot.vel.v.y);

/** Drive `input` for `SPIN_UP_TICKS`, then release. Returns the live world. */
function releaseAfterSpinUp(input: ControlInput, startPose: Pose): SimWorld {
  return new SimWorld({
    robots: [
      {
        config: DEFAULT_ROBOT_CONFIG,
        startPose,
        controller: new ScriptedController(
          createInputTrace('release', [
            { tick: 0, input },
            { tick: SPIN_UP_TICKS, input: NEUTRAL_INPUT },
          ]),
        ),
      },
    ],
    seed: 1,
  });
}

function robotOf(world: SimWorld): RobotSnapshot {
  const robot = world.snapshot().robots[0];
  if (robot === undefined) throw new Error('robot missing');
  return robot;
}

describe('release to stop — translation', () => {
  /**
   * Both axes are tested because a sign or mixing error can show on one and not
   * the other, and because they no longer run the same numbers.
   *
   * `minReleaseSpeed` differs by axis because the drivetrain does. Strafing
   * turns the mecanum rollers and driving straight does not, so a strafe settles
   * at about 0.8 of forward free speed (ASSUMPTIONS.md §2.2) — and it then stops
   * in less distance, because the same roller drag that limited it also brakes
   * it alongside the motors.
   */
  for (const [name, input, start, minReleaseSpeed, maxSlide] of [
    ['forward', FULL_FORWARD, WEST_START, 1.5, 0.25],
    ['strafe', FULL_STRAFE, SOUTH_START, 1.2, 0.2],
  ] as const) {
    describe(name, () => {
      it('sheds most of its speed within a fifth of a second', () => {
        const world = releaseAfterSpinUp(input, start);
        world.stepMany(SPIN_UP_TICKS);
        const released = speedOf(robotOf(world));
        expect(released).toBeGreaterThan(minReleaseSpeed);

        world.stepMany(40); // 0.2 s
        expect(speedOf(robotOf(world))).toBeLessThan(released * 0.2);
      });

      it('comes to rest and stays there', () => {
        const world = releaseAfterSpinUp(input, start);
        world.stepMany(SPIN_UP_TICKS + 400); // 2 s after release
        const stopped = robotOf(world);

        expect(speedOf(stopped)).toBeLessThan(1e-4);
        expect(Math.abs(stopped.vel.omega)).toBeLessThan(1e-6);

        // Still at rest a further two seconds on: nothing re-accelerates it.
        const restingAt = stopped.pose.p;
        world.stepMany(400);
        const later = robotOf(world);
        expect(Math.hypot(later.pose.p.x - restingAt.x, later.pose.p.y - restingAt.y)).toBeLessThan(
          1e-4,
        );
      });

      it('stops within a quarter metre, and does not teleport to a halt', () => {
        const world = releaseAfterSpinUp(input, start);
        world.stepMany(SPIN_UP_TICKS);
        const releasePoint = robotOf(world).pose.p;

        world.stepMany(400);
        const resting = robotOf(world).pose.p;
        const slide = Math.hypot(resting.x - releasePoint.x, resting.y - releasePoint.y);

        // From 1.57 m/s under a brake no stronger than the motor itself, the
        // robot needs about 0.18 m. A far shorter figure would mean velocity
        // was being assigned rather than integrated.
        expect(slide).toBeLessThan(maxSlide);
        expect(slide).toBeGreaterThan(0.08);
      });

      it('decelerates monotonically, never reversing', () => {
        const world = releaseAfterSpinUp(input, start);
        world.stepMany(SPIN_UP_TICKS);

        const forwardAxis = name === 'forward' ? 'x' : 'y';
        let previous = robotOf(world).vel.v[forwardAxis];
        expect(previous).toBeGreaterThan(minReleaseSpeed);

        for (let i = 0; i < 400; i++) {
          world.step();
          const current = robotOf(world).vel.v[forwardAxis];
          // Strictly decreasing toward zero, and never overshooting past it —
          // an overshoot would mean the brake was pushing the robot backwards.
          expect(current).toBeLessThanOrEqual(previous);
          expect(current).toBeGreaterThanOrEqual(-1e-9);
          previous = current;
        }
      });
    });
  }

  /**
   * The physical ceiling on braking, and the sharpest available check that the
   * deceleration comes from the motor model rather than from a damping term.
   *
   * A motor at its free speed generates back-EMF equal to the applied voltage.
   * Short its terminals and the winding sees that full voltage in reverse, so it
   * draws stall current backwards and produces stall torque backwards. Braking
   * from free speed and accelerating from rest are therefore the same number.
   */
  it('brakes exactly as hard as it accelerates', () => {
    const world = releaseAfterSpinUp(FULL_FORWARD, WEST_START);
    world.stepMany(SPIN_UP_TICKS);

    const before = robotOf(world).vel.v.x;
    const volts = world.batteryVolts;
    world.step();
    const after = robotOf(world).vel.v.x;

    const deceleration = (before - after) / DT_SECONDS;
    const derived = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const peakAcceleration = analyticPeakAcceleration(
      derived.drivetrain,
      asVolts(volts),
      derived.massKg,
    );

    expect(deceleration).toBeGreaterThan(0);
    expect(deceleration / peakAcceleration).toBeCloseTo(1, 2);
  });
});

describe('release to stop — rotation', () => {
  it('sheds most of its spin within a fifth of a second', () => {
    const world = releaseAfterSpinUp(FULL_SPIN, CENTRE);
    world.stepMany(SPIN_UP_TICKS);
    const released = robotOf(world).vel.omega;
    expect(released).toBeGreaterThan(3);

    world.stepMany(40);
    expect(Math.abs(robotOf(world).vel.omega)).toBeLessThan(Math.abs(released) * 0.05);
  });

  it('stops within a few degrees of extra rotation', () => {
    const world = releaseAfterSpinUp(FULL_SPIN, CENTRE);
    world.stepMany(SPIN_UP_TICKS);
    const releasedHeading = robotOf(world).pose.theta;

    world.stepMany(400);
    const overshootDeg = ((robotOf(world).pose.theta - releasedHeading) * 180) / Math.PI;

    // Rotational inertia is small next to the torque four wheels can brake
    // with, so a spin dies far faster than a translation.
    expect(overshootDeg).toBeGreaterThan(1);
    expect(overshootDeg).toBeLessThan(15);
    expect(Math.abs(robotOf(world).vel.omega)).toBeLessThan(1e-6);
  });

  it('does not translate while braking a pure spin', () => {
    const world = releaseAfterSpinUp(FULL_SPIN, CENTRE);
    world.stepMany(SPIN_UP_TICKS + 400);
    const resting = robotOf(world);

    expect(Math.hypot(resting.pose.p.x, resting.pose.p.y)).toBeLessThan(1e-6);
    expect(speedOf(resting)).toBeLessThan(1e-6);
  });
});

describe('braking is a consequence of the motor model, not of a damping term', () => {
  /**
   * A drag term would slow an *unpowered* body too. Nothing damps a game piece
   * (ASSUMPTIONS.md §5.5), so a piece knocked across the field must keep its
   * speed while the robot beside it stops. If both decayed, something global had
   * been added to the integrator.
   */
  it('leaves an undriven body coasting while the robot stops', () => {
    const result = runHeadless({
      robots: [
        {
          config: DEFAULT_ROBOT_CONFIG,
          startPose: WEST_START,
          controller: new ScriptedController(
            createInputTrace('release', [
              { tick: 0, input: FULL_FORWARD },
              { tick: SPIN_UP_TICKS, input: NEUTRAL_INPUT },
            ]),
          ),
        },
      ],
      pieces: [
        {
          pieceId: 'coaster',
          pieceType: 'test',
          diameterIn: 5,
          massLb: 0.3,
          startPositionM: vec2(0, 1.2),
        },
      ],
      ticks: SPIN_UP_TICKS + 400,
    });

    const robot = result.finalSnapshot.robots[0];
    const piece = result.finalSnapshot.pieces[0];
    if (robot === undefined || piece === undefined) throw new Error('entities missing');

    expect(speedOf(robot)).toBeLessThan(1e-4);
    // The piece was never touched, so it simply never moved — the point is that
    // no global damping exists to have moved or slowed it.
    expect(piece.vel.v.x).toBe(0);
    expect(piece.vel.v.y).toBe(0);
  });

  it('holds still under a zero command from rest', () => {
    const world = releaseAfterSpinUp(NEUTRAL_INPUT, CENTRE);
    world.stepMany(400);
    const robot = robotOf(world);

    expect(robot.pose.p.x).toBe(0);
    expect(robot.pose.p.y).toBe(0);
    expect(robot.vel.v.x).toBe(0);
    expect(robot.vel.omega).toBe(0);
  });
});
