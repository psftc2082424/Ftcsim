import { describe, expect, it } from 'vitest';
import {
  chassisToWheelVelocities,
  commandToWheels,
  fromArray,
  saturate,
  toArray,
  wheelForcesToChassisWrench,
  wheelVelocitiesToChassis,
  type ChassisVelocity,
  type WheelValues,
} from './mecanumKinematics.js';

/** Representative FTC geometry: an 18 in robot gives k of roughly 0.2 m. */
const K = 0.2;

const closeToWheels = (actual: WheelValues, expected: WheelValues, digits = 12): void => {
  expect(actual.frontLeft).toBeCloseTo(expected.frontLeft, digits);
  expect(actual.frontRight).toBeCloseTo(expected.frontRight, digits);
  expect(actual.backLeft).toBeCloseTo(expected.backLeft, digits);
  expect(actual.backRight).toBeCloseTo(expected.backRight, digits);
};

describe('inverse kinematics — canonical motions', () => {
  it('drives all four wheels equally forward for pure forward motion', () => {
    const w = chassisToWheelVelocities({ vx: 1, vy: 0, omega: 0 }, K);
    closeToWheels(w, { frontLeft: 1, frontRight: 1, backLeft: 1, backRight: 1 });
  });

  it('forms the X pattern for a pure left strafe', () => {
    // Strafing left: front-left and back-right run backward, the other
    // diagonal runs forward.
    const w = chassisToWheelVelocities({ vx: 0, vy: 1, omega: 0 }, K);
    closeToWheels(w, { frontLeft: -1, frontRight: 1, backLeft: 1, backRight: -1 });
  });

  it('runs the left side backward for a counter-clockwise spin', () => {
    const w = chassisToWheelVelocities({ vx: 0, vy: 0, omega: 1 }, K);
    closeToWheels(w, { frontLeft: -K, frontRight: K, backLeft: -K, backRight: K });
  });

  it('superposes combined translation and rotation', () => {
    const chassis: ChassisVelocity = { vx: 0.7, vy: -0.3, omega: 1.4 };
    const combined = chassisToWheelVelocities(chassis, K);

    const a = chassisToWheelVelocities({ vx: 0.7, vy: 0, omega: 0 }, K);
    const b = chassisToWheelVelocities({ vx: 0, vy: -0.3, omega: 0 }, K);
    const c = chassisToWheelVelocities({ vx: 0, vy: 0, omega: 1.4 }, K);

    closeToWheels(combined, {
      frontLeft: a.frontLeft + b.frontLeft + c.frontLeft,
      frontRight: a.frontRight + b.frontRight + c.frontRight,
      backLeft: a.backLeft + b.backLeft + c.backLeft,
      backRight: a.backRight + b.backRight + c.backRight,
    });
  });
});

describe('forward kinematics', () => {
  it('inverts the inverse kinematics exactly', () => {
    const cases: ChassisVelocity[] = [
      { vx: 0, vy: 0, omega: 0 },
      { vx: 2.4, vy: 0, omega: 0 },
      { vx: 0, vy: -1.7, omega: 0 },
      { vx: 0, vy: 0, omega: 3.1 },
      { vx: 1.1, vy: 0.6, omega: -2.2 },
      { vx: -0.4, vy: -0.9, omega: 0.05 },
    ];

    for (const chassis of cases) {
      const round = wheelVelocitiesToChassis(chassisToWheelVelocities(chassis, K), K);
      expect(round.vx).toBeCloseTo(chassis.vx, 12);
      expect(round.vy).toBeCloseTo(chassis.vy, 12);
      expect(round.omega).toBeCloseTo(chassis.omega, 12);
    }
  });

  it('holds for any positive k', () => {
    const chassis: ChassisVelocity = { vx: 1.3, vy: -0.8, omega: 2.0 };
    for (const k of [0.05, 0.15, 0.2, 0.35, 1.0]) {
      const round = wheelVelocitiesToChassis(chassisToWheelVelocities(chassis, k), k);
      expect(round.vx).toBeCloseTo(chassis.vx, 12);
      expect(round.vy).toBeCloseTo(chassis.vy, 12);
      expect(round.omega).toBeCloseTo(chassis.omega, 12);
    }
  });
});

describe('wrench mapping (Jacobian transpose)', () => {
  it('sums four equal forward forces into pure forward force', () => {
    const wrench = wheelForcesToChassisWrench(
      { frontLeft: 10, frontRight: 10, backLeft: 10, backRight: 10 },
      K,
    );
    expect(wrench.fx).toBeCloseTo(40, 12);
    expect(wrench.fy).toBeCloseTo(0, 12);
    expect(wrench.mz).toBeCloseTo(0, 12);
  });

  it('turns the strafe pattern into pure lateral force', () => {
    const wrench = wheelForcesToChassisWrench(
      { frontLeft: -10, frontRight: 10, backLeft: 10, backRight: -10 },
      K,
    );
    expect(wrench.fx).toBeCloseTo(0, 12);
    expect(wrench.fy).toBeCloseTo(40, 12);
    expect(wrench.mz).toBeCloseTo(0, 12);
  });

  it('turns the spin pattern into pure torque', () => {
    const wrench = wheelForcesToChassisWrench(
      { frontLeft: -10, frontRight: 10, backLeft: -10, backRight: 10 },
      K,
    );
    expect(wrench.fx).toBeCloseTo(0, 12);
    expect(wrench.fy).toBeCloseTo(0, 12);
    expect(wrench.mz).toBeCloseTo(40 * K, 12);
  });

  /**
   * The wrench map must be the transpose of the velocity map, not an
   * independently invented force distribution. Equivalent statement: mechanical
   * power computed at the wheels equals power computed at the chassis.
   */
  it('conserves power between the wheel and chassis descriptions', () => {
    const chassis: ChassisVelocity = { vx: 1.2, vy: -0.5, omega: 1.9 };
    const forces: WheelValues = {
      frontLeft: 3,
      frontRight: -7,
      backLeft: 11,
      backRight: 2.5,
    };

    const wheelVel = chassisToWheelVelocities(chassis, K);
    const wheelPower =
      forces.frontLeft * wheelVel.frontLeft +
      forces.frontRight * wheelVel.frontRight +
      forces.backLeft * wheelVel.backLeft +
      forces.backRight * wheelVel.backRight;

    const wrench = wheelForcesToChassisWrench(forces, K);
    const chassisPower = wrench.fx * chassis.vx + wrench.fy * chassis.vy + wrench.mz * chassis.omega;

    expect(wheelPower).toBeCloseTo(chassisPower, 12);
  });
});

describe('saturation', () => {
  it('leaves already-valid commands untouched', () => {
    const w = commandToWheels(0.4, 0.2, 0.1);
    expect(saturate(w)).toBe(w);
  });

  it('brings the peak wheel to exactly unit magnitude', () => {
    const w = commandToWheels(1, 1, 1); // front-right would be 3
    const s = saturate(w);
    const peak = Math.max(...toArray(s).map(Math.abs));
    expect(peak).toBeCloseTo(1, 12);
  });

  /**
   * The property that matters: saturation may slow the robot but must not
   * steer it. Uniform scaling keeps every wheel ratio fixed, so the resulting
   * chassis motion stays parallel to the commanded one.
   */
  it('preserves commanded motion direction', () => {
    const cases: Array<[number, number, number]> = [
      [1, 1, 1],
      [1, -1, 0.5],
      [0.9, 0.9, 0.9],
      [-1, 0.8, -0.7],
      [2, -3, 1.5],
    ];

    for (const [x, y, turn] of cases) {
      const raw = commandToWheels(x, y, turn);
      const sat = saturate(raw);

      const rawChassis = wheelVelocitiesToChassis(raw, K);
      const satChassis = wheelVelocitiesToChassis(sat, K);

      const peak = Math.max(...toArray(raw).map(Math.abs));
      const expectedScale = peak > 1 ? 1 / peak : 1;

      expect(satChassis.vx).toBeCloseTo(rawChassis.vx * expectedScale, 12);
      expect(satChassis.vy).toBeCloseTo(rawChassis.vy * expectedScale, 12);
      expect(satChassis.omega).toBeCloseTo(rawChassis.omega * expectedScale, 12);
    }
  });

  it('never produces a wheel command outside [-1, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const x = ((i * 7) % 41) / 10 - 2;
      const y = ((i * 13) % 37) / 10 - 2;
      const turn = ((i * 23) % 31) / 10 - 1.5;
      for (const v of toArray(saturate(commandToWheels(x, y, turn)))) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  it('leaves an all-zero command alone', () => {
    const zero = commandToWheels(0, 0, 0);
    expect(toArray(saturate(zero))).toEqual([0, 0, 0, 0]);
  });
});

describe('wheel value helpers', () => {
  it('round-trips through the fixed array order', () => {
    const w: WheelValues = { frontLeft: 1, frontRight: 2, backLeft: 3, backRight: 4 };
    expect(toArray(w)).toEqual([1, 2, 3, 4]);
    expect(fromArray([1, 2, 3, 4])).toEqual(w);
  });
});
