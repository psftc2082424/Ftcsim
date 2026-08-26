/**
 * Regression: a robot that meets the perimeter flat-on is stopped, not spun.
 *
 * ── The bug these lock down ────────────────────────────────────────────────
 *
 * `sat.ts` used to return a single contact point: the deepest vertex of B along
 * the contact normal, averaging ties. For a robot against a perimeter wall that
 * vertex set is the wall's *entire* inner face, so the averaged point landed at
 * the middle of the wall — up to 1.8 m from where the robot actually touched.
 * The normal impulse acted through a lever arm that long, and a robot driving
 * square into a wall anywhere but its exact centre was spun off it at more than
 * 2 rad/s and thrown sideways down the field.
 *
 * The fix is a clipped contact manifold, so a face-on contact resolves at both
 * ends of the touching face and the two torques cancel. These tests assert the
 * behaviour rather than the mechanism, so they stay meaningful if the
 * narrowphase is rewritten again.
 *
 * ── What must *not* regress with it ────────────────────────────────────────
 *
 * Contacts are frictionless (ASSUMPTIONS.md §5.1), so a robot pressed against a
 * wall must still slide freely along it, and must still be able to turn. A fix
 * that froze the robot on contact would pass the first half of this file and
 * fail the second.
 */

import { describe, expect, it } from 'vitest';
import { SimWorld } from './simWorld.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { LatchedController } from '../control/controller.js';
import { createControlInput, NEUTRAL_INPUT, type ControlInput } from '../control/controlInput.js';
import { createStandardField, fieldBounds } from '../field/fieldTemplate.js';
import { PENETRATION_SLOP_M } from '../physics/resolve.js';
import { inchesToMeters } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { RobotSnapshot } from './snapshot.js';

const BOUNDS = fieldBounds(createStandardField());
const HALF_ROBOT_M = inchesToMeters(DEFAULT_ROBOT_CONFIG.chassis.lengthIn) / 2;

/**
 * Where a squared-up robot's centre comes to rest against a wall: the wall face
 * less half the robot, plus the penetration the resolver tolerates
 * (`PENETRATION_SLOP_M`).
 */
const REST_AGAINST_WALL = BOUNDS.maxX - HALF_ROBOT_M + PENETRATION_SLOP_M;

interface Rig {
  readonly world: SimWorld;
  readonly command: LatchedController;
  robot(): RobotSnapshot;
  drive(input: ControlInput, ticks: number): void;
}

/**
 * A robot placed a little short of the east wall, square to it.
 *
 * `offCentreY` is the whole point: at y = 0 the robot's centre lined up with the
 * midpoint of the wall, which is the one place the old single-point contact
 * happened to be correct. Every case here is deliberately off-centre.
 */
function rig(offCentreY: number, headingRad = 0): Rig {
  const command = new LatchedController('test');
  const world = new SimWorld({
    robots: [
      {
        config: DEFAULT_ROBOT_CONFIG,
        controller: command,
        startPose: { p: vec2(0.9, offCentreY), theta: headingRad },
      },
    ],
    seed: 1,
  });

  const robot = (): RobotSnapshot => {
    const found = world.snapshot().robots[0];
    if (found === undefined) throw new Error('robot missing');
    return found;
  };

  return {
    world,
    command,
    robot,
    drive(input: ControlInput, ticks: number): void {
      command.set(input);
      world.stepMany(ticks);
    },
  };
}

describe('driving flat into a wall', () => {
  /**
   * Four offsets across the wall's length. The failure mode scaled with the
   * distance from the wall's midpoint, so the far offsets are the ones that used
   * to spin hardest.
   */
  for (const offCentreY of [0.25, 0.5, 1.0, 1.5]) {
    describe(`at y = ${offCentreY} m`, () => {
      it('stops without rotating or sliding sideways', () => {
        const test = rig(offCentreY);
        test.drive(createControlInput(1, 0, 0), 400);
        const robot = test.robot();

        expect(robot.pose.theta).toBeCloseTo(0, 9);
        expect(robot.vel.omega).toBeCloseTo(0, 9);
        expect(robot.pose.p.y).toBeCloseTo(offCentreY, 9);
        expect(robot.vel.v.y).toBeCloseTo(0, 9);
        expect(robot.vel.v.x).toBeCloseTo(0, 9);
        expect(robot.pose.p.x).toBeCloseTo(REST_AGAINST_WALL, 3);
      });

      it('never bounces back off the wall', () => {
        const test = rig(offCentreY);
        test.command.set(createControlInput(1, 0, 0));

        let furthest = -Infinity;
        for (let i = 0; i < 400; i++) {
          test.world.step();
          const robot = test.robot();
          // Restitution is zero (ASSUMPTIONS.md §5.1): the robot may stop, but
          // it may never be pushed back the way it came.
          expect(robot.vel.v.x).toBeGreaterThan(-1e-6);
          furthest = Math.max(furthest, robot.pose.p.x);
        }

        // And it never ends up further back than the deepest point it reached.
        expect(test.robot().pose.p.x).toBeGreaterThan(furthest - 0.002);
      });
    });
  }

  it('stops the same way against all four walls', () => {
    const headings: readonly [string, number][] = [
      ['east', 0],
      ['north', Math.PI / 2],
      ['west', Math.PI],
      ['south', -Math.PI / 2],
    ];

    for (const [name, heading] of headings) {
      const command = new LatchedController('test');
      // Placed off-centre along whichever wall it faces.
      const start = vec2(Math.cos(heading) * 0.9 - Math.sin(heading) * 0.7, Math.sin(heading) * 0.9 + Math.cos(heading) * 0.7);
      const world = new SimWorld({
        robots: [
          { config: DEFAULT_ROBOT_CONFIG, controller: command, startPose: { p: start, theta: heading } },
        ],
        seed: 1,
      });

      command.set(createControlInput(1, 0, 0));
      world.stepMany(500);

      const robot = world.snapshot().robots[0];
      if (robot === undefined) throw new Error('robot missing');

      expect(robot.pose.theta, `${name} wall heading`).toBeCloseTo(heading, 6);
      expect(robot.vel.omega, `${name} wall spin`).toBeCloseTo(0, 6);
      expect(Math.hypot(robot.vel.v.x, robot.vel.v.y), `${name} wall speed`).toBeCloseTo(0, 6);
    }
  });
});

describe('holding a command into the wall', () => {
  it('stays pressed against the wall instead of creeping or turning', () => {
    const test = rig(0.7);
    test.drive(createControlInput(1, 0, 0), 400);
    const settled = test.robot().pose;

    // Four more seconds of full throttle into the wall.
    test.world.stepMany(800);
    const held = test.robot();

    expect(held.pose.p.x).toBeCloseTo(settled.p.x, 6);
    expect(held.pose.p.y).toBeCloseTo(settled.p.y, 6);
    expect(held.pose.theta).toBeCloseTo(0, 6);
    expect(Math.hypot(held.vel.v.x, held.vel.v.y)).toBeCloseTo(0, 6);
  });

  it('keeps the whole robot inside the field while pressed', () => {
    const test = rig(0.7);
    test.command.set(createControlInput(1, 0, 0));

    for (let i = 0; i < 1200; i++) {
      test.world.step();
      const robot = test.robot();
      // Squared up, the robot's leading face is exactly half a robot ahead.
      expect(robot.pose.p.x + HALF_ROBOT_M).toBeLessThan(BOUNDS.maxX + 0.002);
    }
  });

  it('releases without recoil', () => {
    const test = rig(0.7);
    test.drive(createControlInput(1, 0, 0), 400);
    const pressed = test.robot().pose;

    test.drive(NEUTRAL_INPUT, 400);
    const released = test.robot();

    // Releasing lets positional correction settle the last fraction of a
    // millimetre of penetration out; that is a settle, not a recoil.
    expect(pressed.p.x - released.pose.p.x).toBeLessThan(2 * PENETRATION_SLOP_M);
    expect(released.pose.p.x).toBeGreaterThan(pressed.p.x - 2 * PENETRATION_SLOP_M);
    expect(released.pose.p.y).toBeCloseTo(pressed.p.y, 6);
    expect(Math.hypot(released.vel.v.x, released.vel.v.y)).toBeLessThan(1e-4);
  });
});

describe('motion along a wall stays available', () => {
  it('strafes along the wall while still commanded into it', () => {
    const test = rig(-0.5);
    test.drive(createControlInput(1, 0, 0), 400);
    const pressed = test.robot().pose;

    // Forward *and* left: the forward half is blocked, the left half is not.
    test.drive(createControlInput(1, 1, 0), 200);
    const sliding = test.robot();

    expect(sliding.pose.p.y - pressed.p.y).toBeGreaterThan(0.3);
    expect(sliding.pose.p.x).toBeCloseTo(pressed.p.x, 3);
    expect(sliding.pose.theta).toBeCloseTo(0, 6);
  });

  it('turns while pressed against the wall', () => {
    const test = rig(-0.5);
    test.drive(createControlInput(1, 0, 0), 400);

    test.drive(createControlInput(1, 0, 1), 200);
    const turned = test.robot();

    // Rotation off a flat contact is physical — a corner digs in and the robot
    // pivots away from the wall — so it must remain possible.
    expect(Math.abs(turned.pose.theta)).toBeGreaterThan(0.05);
  });

  it('backs away when reversed', () => {
    const test = rig(0.4);
    test.drive(createControlInput(1, 0, 0), 400);
    const pressed = test.robot().pose;

    test.drive(createControlInput(-1, 0, 0), 200);
    const backed = test.robot();

    expect(pressed.p.x - backed.pose.p.x).toBeGreaterThan(0.5);
    expect(backed.pose.theta).toBeCloseTo(0, 6);
  });
});

describe('angled contact still behaves like a collision', () => {
  /**
   * The face-on case must not be bought by killing rotation everywhere. A robot
   * that meets a wall at an angle touches on one corner, and a single-point
   * contact does produce a torque — it squares the robot up against the wall,
   * which is exactly what happens on a real field.
   */
  it('rotates a robot that hits the wall at an angle', () => {
    const test = rig(0.6, 0.3);
    test.drive(createControlInput(1, 0, 0), 600);
    const robot = test.robot();

    expect(Math.abs(robot.pose.theta)).toBeLessThan(0.3);
    expect(robot.pose.theta).toBeGreaterThan(-0.3);
    // Settled: it squares up and then stops, rather than spinning on.
    expect(Math.abs(robot.vel.omega)).toBeLessThan(1e-3);
  });
});
