/**
 * Arc driving — forward and turn at once.
 *
 * An arc is visibly slower than driving straight, and this file exists to pin
 * *why*, because the answer is not obvious and the temptation to "fix" it with
 * a multiplier is real. Two effects, both emergent, neither a correction:
 *
 * ── 1. Command saturation, which is most of it ─────────────────────────────
 *
 * `commandToWheels(1, 0, t)` asks for `1 + t` from the outside wheels, and a
 * duty cycle cannot exceed 1. `saturate` divides *all four* by that peak so the
 * commanded motion keeps its direction (PRODUCT_SPEC.md §6), which scales the
 * forward component to `1 / (1 + t)`. Every real drivetrain does this; the
 * alternative — clipping each wheel on its own — would curve a robot that asked
 * to go straight.
 *
 * Since each motor settles where its own torque reaches zero, the wheel it
 * drives settles at `duty x v_free`, so the chassis settles at the *mean* of
 * the saturated duties times free speed.
 *
 * ── 2. The centripetal term, which is the surprising few percent ───────────
 *
 * A robot on a circular path needs a force toward the centre. Its wheels are
 * the only thing that can supply one, and a mecanum supplies lateral force by
 * running its wheels at unequal speeds — so an arcing robot **crabs slightly**,
 * carrying a small body-frame `vy` even though nothing commanded a strafe.
 *
 * That is not drift and not an error. In the body frame the steady state is
 *
 *     Fx = -m w vy        Fy = m w vx
 *
 * and the second identity is asserted below directly. The first costs a little
 * forward speed, which is the gap between the saturation prediction and what
 * the simulation actually reaches.
 */

import { describe, expect, it } from 'vitest';
import { SimWorld } from '../sim/simWorld.js';
import { constantController } from '../control/scripted.js';
import { createControlInput } from '../control/controlInput.js';
import { DEFAULT_ROBOT_CONFIG } from '../robot/robotConfig.js';
import { deriveRobot } from '../robot/derive.js';
import {
  MECANUM_ROLLER_DRAG_N_PER_MPS,
  analyticFreeSpeed,
} from './drivetrain.js';
import {
  commandToWheels,
  saturate,
  toArray,
  wheelVelocitiesToChassis,
  type WheelValues,
} from './mecanumKinematics.js';
import { asVolts } from '../units/convert.js';
import { vec2 } from '../math/vec2.js';
import type { FieldTemplate } from '../field/fieldTemplate.js';

/**
 * A field with no perimeter.
 *
 * An arc curves back into a wall within a couple of seconds on a 12 ft field,
 * so a run that kept the perimeter would measure a collision rather than a
 * drivetrain.
 */
const OPEN_FIELD: FieldTemplate = {
  id: 'open',
  name: 'No perimeter',
  widthM: 1000,
  lengthM: 1000,
  bodies: [],
};

const DERIVED = deriveRobot(DEFAULT_ROBOT_CONFIG);
const SETTLE_TICKS = 1500;

interface Settled {
  readonly vx: number;
  readonly vy: number;
  readonly omega: number;
  readonly volts: number;
  readonly wheelSpeedsMps: WheelValues;
}

/** Hold a command until the chassis stops changing, then report it. */
function settle(x: number, turn: number): Settled {
  const world = new SimWorld({
    robots: [
      {
        config: DEFAULT_ROBOT_CONFIG,
        controller: constantController(createControlInput(x, 0, turn)),
        startPose: { p: vec2(0, 0), theta: 0 },
      },
    ],
    field: OPEN_FIELD,
    seed: 1,
  });
  world.stepMany(SETTLE_TICKS);

  const robot = world.snapshot().robots[0];
  if (robot === undefined) throw new Error('robot missing');

  // Motor speed back to the speed of the wheel it drives.
  const perWheel = (omega: number): number =>
    (omega * DERIVED.wheelRadius) / DERIVED.drivetrain.gearRatio;

  return {
    vx: robot.chassis.vx,
    vy: robot.chassis.vy,
    omega: robot.vel.omega,
    volts: world.batteryVolts,
    wheelSpeedsMps: {
      frontLeft: perWheel(robot.drive.motorSpeeds.frontLeft),
      frontRight: perWheel(robot.drive.motorSpeeds.frontRight),
      backLeft: perWheel(robot.drive.motorSpeeds.backLeft),
      backRight: perWheel(robot.drive.motorSpeeds.backRight),
    },
  };
}

/** Mean of the four saturated duties for a forward-and-turn command. */
const meanDuty = (turn: number): number => {
  const duties = toArray(saturate(commandToWheels(1, 0, turn)));
  return (duties[0] + duties[1] + duties[2] + duties[3]) / 4;
};

describe('arc driving — the slowdown is saturation, not a defect', () => {
  it('leaves straight-line driving untouched', () => {
    const straight = settle(1, 0);

    expect(straight.vx).toBeCloseTo(analyticFreeSpeed(DERIVED.drivetrain, asVolts(12)), 4);
    expect(straight.vy).toBeCloseTo(0, 12);
    expect(straight.omega).toBeCloseTo(0, 12);
  });

  /**
   * The headline number. `saturate` scales all four duties by `1 + t`, so the
   * forward component of the command — and therefore the settled speed — is
   * `1 / (1 + t)` of straight-line, before the centripetal term takes its few
   * percent.
   */
  it('settles near free speed over one plus the turn command', () => {
    const straight = settle(1, 0).vx;

    for (const turn of [0.25, 0.5, 0.75, 1]) {
      const ratio = settle(1, turn).vx / straight;
      expect(meanDuty(turn)).toBeCloseTo(1 / (1 + turn), 12);
      expect(ratio).toBeLessThan(1 / (1 + turn));
      expect(ratio).toBeGreaterThan((1 / (1 + turn)) * 0.94);
    }
  });

  /**
   * Every wheel is driven at the speed the chassis motion demands of it. A
   * mismatched pairing of duties to speeds — the obvious way to get this wrong —
   * would show up here first, because it would break the identity between the
   * four wheel speeds and the chassis velocity they encode.
   */
  it('drives every wheel at the speed the kinematics demand', () => {
    for (const turn of [0, 0.25, 0.5, 1]) {
      const state = settle(1, turn);
      const fromWheels = wheelVelocitiesToChassis(state.wheelSpeedsMps, DERIVED.kinematicK);

      expect(fromWheels.vx).toBeCloseTo(state.vx, 9);
      expect(fromWheels.vy).toBeCloseTo(state.vy, 9);
      expect(fromWheels.omega).toBeCloseTo(state.omega, 9);
    }
  });

  /** Forward and turn are not commanded per corner, so the sides stay paired. */
  it('keeps the two wheels on each side at the same speed', () => {
    const state = settle(1, 0.5);
    const { frontLeft, frontRight, backLeft, backRight } = state.wheelSpeedsMps;

    // The pairing that survives is diagonal, because a crabbing robot has the
    // front and back of a side moving differently: fl-bl differ by 2*vy.
    expect(frontLeft - backLeft).toBeCloseTo(-2 * state.vy, 9);
    expect(frontRight - backRight).toBeCloseTo(2 * state.vy, 9);
  });
});

describe('arc driving — the crab is centripetal force', () => {
  /**
   * The identity that proves the lateral velocity is a circular-motion
   * requirement rather than a leak.
   *
   * At steady state in the body frame `Fy = m w vx`, and the lateral force a
   * mecanum makes at velocity `vy` is `-(4 A B + 8 c) vy`, where `A B` is the
   * per-wheel back-EMF force coefficient and `c` the roller drag. Equating them
   * predicts `vy` from `vx` and `w` with no free parameter.
   */
  it('carries exactly the lateral velocity the circular path demands', () => {
    const { motor, drivetrain, massKg, wheelRadius } = DERIVED;
    const forcePerSpeed =
      (motor.kT * motor.kE * drivetrain.gearRatio * drivetrain.gearRatio * drivetrain.efficiency) /
      (motor.resistance * wheelRadius * wheelRadius);
    const lateralResistance = 4 * forcePerSpeed + 8 * MECANUM_ROLLER_DRAG_N_PER_MPS;

    for (const turn of [0.25, 0.5, 1]) {
      const state = settle(1, turn);
      const predicted = -(massKg * state.omega * state.vx) / lateralResistance;

      expect(state.vy).toBeCloseTo(predicted, 3);
    }
  });

  it('crabs toward the inside of the turn, never the outside', () => {
    // Turning left (+omega) throws the robot right, so it crabs right (-vy).
    expect(settle(1, 0.5).omega).toBeGreaterThan(0);
    expect(settle(1, 0.5).vy).toBeLessThan(0);

    expect(settle(1, -0.5).omega).toBeLessThan(0);
    expect(settle(1, -0.5).vy).toBeGreaterThan(0);
  });

  it('does not crab when there is no arc to hold', () => {
    expect(settle(1, 0).vy).toBeCloseTo(0, 12);
    // Spinning on the spot has no forward velocity to bend, so no lateral force
    // is needed either.
    expect(settle(0, 1).vy).toBeCloseTo(0, 9);
    expect(settle(0, 1).vx).toBeCloseTo(0, 9);
  });

  it('grows the crab with the tightness of the arc', () => {
    const gentle = Math.abs(settle(1, 0.25).vy);
    const hard = Math.abs(settle(1, 1).vy);
    expect(hard).toBeGreaterThan(gentle);
  });
});
