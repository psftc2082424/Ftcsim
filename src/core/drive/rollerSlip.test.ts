/**
 * The mecanum roller degree of freedom, and the forward/strafe asymmetry it
 * produces.
 *
 * The hub kinematics in `mecanumKinematics.ts` are symmetric: pure forward and
 * pure lateral motion turn the wheels at the same rate and need the same wheel
 * forces. That symmetry is a real property of an ideal 45° mecanum, and it is
 * why the model used to strafe exactly as fast as it drove.
 *
 * The rollers break it. `s = v_c·û − ω_wheel·r (x̂·û)` collapses to
 * `√2 (vy ± a·ω)` with **no vx term**, so a mecanum wheel driving straight ahead
 * does not turn its rollers at all. Resistance in the roller path is therefore
 * invisible forward and maximal sideways — which is the asymmetry, derived from
 * geometry rather than asserted by a factor.
 *
 * These tests pin the geometry, the energy behaviour, and the resulting speeds.
 */

import { describe, expect, it } from 'vitest';
import {
  MECANUM_ROLLER_DRAG_N_PER_MPS,
  analyticFreeSpeed,
  analyticPeakAcceleration,
  analyticSpinRate,
  analyticStrafeFreeSpeed,
  createDrivetrainSpec,
  solveDrivetrain,
  type DrivetrainSpec,
} from './drivetrain.js';
import {
  rollerForcesToChassisWrench,
  rollerSlipSpeeds,
  toArray,
  type ChassisVelocity,
} from './mecanumKinematics.js';
import { IdealTraction } from './traction.js';
import { createMotorModel } from '../motor/motorModel.js';
import { getMotorDatasheet } from '../motor/catalog/goBILDA.js';
import { asVolts, inchesToMeters, poundsToKilograms } from '../units/convert.js';
import { meters } from '../units/si.js';

const NOMINAL = asVolts(12);
const HALF_WHEELBASE = 0.19685;
const MASS_KG = poundsToKilograms(32);

function spec(overrides: { rollerDrag?: number } = {}): DrivetrainSpec {
  return createDrivetrainSpec({
    motor: createMotorModel(getMotorDatasheet('gobilda-5203-312')),
    gearRatio: 1,
    wheelRadius: meters(inchesToMeters(3.78) / 2),
    kinematicK: HALF_WHEELBASE * 2,
    halfWheelbase: HALF_WHEELBASE,
    ...overrides,
  });
}

const solve = (drivetrain: DrivetrainSpec, chassis: ChassisVelocity, y: number, x = 0, turn = 0) =>
  solveDrivetrain(drivetrain, chassis, { x, y, turn }, NOMINAL, IdealTraction, MASS_KG);

describe('roller slip is a function of lateral motion only', () => {
  it('does not turn the rollers when the robot drives straight', () => {
    const slip = rollerSlipSpeeds({ vx: 3, vy: 0, omega: 0 }, HALF_WHEELBASE);
    for (const value of toArray(slip)) expect(value).toBe(0);
  });

  it('turns every roller at sqrt(2) times the strafe speed', () => {
    const slip = rollerSlipSpeeds({ vx: 0, vy: 1, omega: 0 }, HALF_WHEELBASE);
    for (const value of toArray(slip)) expect(value).toBeCloseTo(Math.SQRT2, 12);
  });

  it('is unchanged by adding any amount of forward motion', () => {
    const strafing = rollerSlipSpeeds({ vx: 0, vy: 1, omega: 0 }, HALF_WHEELBASE);
    const diagonal = rollerSlipSpeeds({ vx: 5, vy: 1, omega: 0 }, HALF_WHEELBASE);
    expect(toArray(diagonal)).toEqual(toArray(strafing));
  });

  /** Spinning drags each contact patch sideways, front and rear oppositely. */
  it('turns front and rear rollers opposite ways when spinning in place', () => {
    const slip = rollerSlipSpeeds({ vx: 0, vy: 0, omega: 1 }, HALF_WHEELBASE);

    expect(slip.frontLeft).toBeCloseTo(Math.SQRT2 * HALF_WHEELBASE, 12);
    expect(slip.frontRight).toBeCloseTo(Math.SQRT2 * HALF_WHEELBASE, 12);
    expect(slip.backLeft).toBeCloseTo(-Math.SQRT2 * HALF_WHEELBASE, 12);
    expect(slip.backRight).toBeCloseTo(-Math.SQRT2 * HALF_WHEELBASE, 12);
  });
});

describe('roller resistance can only remove energy', () => {
  /**
   * The reason the drag is mapped back through the transpose of the slip
   * Jacobian rather than assembled from four contact forces by hand: the
   * transpose makes `power = s·f = -c Σ s²`, which is non-positive whatever the
   * chassis is doing. The hand-assembled version injects energy into a chassis
   * that is longer than it is wide.
   */
  it('never produces positive power, for any chassis motion', () => {
    const drag = MECANUM_ROLLER_DRAG_N_PER_MPS;
    const halfWheelbase = 0.3; // deliberately not square

    for (const chassis of [
      { vx: 1, vy: 0, omega: 0 },
      { vx: 0, vy: 1, omega: 0 },
      { vx: 0, vy: 0, omega: 2 },
      { vx: 1.2, vy: -0.8, omega: 1.5 },
      { vx: -2, vy: 0.5, omega: -3 },
    ] as const) {
      const slip = rollerSlipSpeeds(chassis, halfWheelbase);
      const forces = {
        frontLeft: -drag * slip.frontLeft,
        frontRight: -drag * slip.frontRight,
        backLeft: -drag * slip.backLeft,
        backRight: -drag * slip.backRight,
      };
      const wrench = rollerForcesToChassisWrench(forces, halfWheelbase);
      const power = wrench.fx * chassis.vx + wrench.fy * chassis.vy + wrench.mz * chassis.omega;

      expect(power).toBeLessThanOrEqual(0);
    }
  });

  it('applies no forward force whatever the robot is doing', () => {
    for (const chassis of [
      { vx: 2, vy: 0, omega: 0 },
      { vx: 0, vy: 2, omega: 0 },
      { vx: 1, vy: 1, omega: 1 },
    ] as const) {
      const slip = rollerSlipSpeeds(chassis, HALF_WHEELBASE);
      const wrench = rollerForcesToChassisWrench(slip, HALF_WHEELBASE);
      expect(wrench.fx).toBe(0);
    }
  });

  it('opposes the lateral motion it is given', () => {
    const drag = MECANUM_ROLLER_DRAG_N_PER_MPS;
    for (const vy of [-2, -0.5, 0.5, 2]) {
      const slip = rollerSlipSpeeds({ vx: 0, vy, omega: 0 }, HALF_WHEELBASE);
      const wrench = rollerForcesToChassisWrench(
        {
          frontLeft: -drag * slip.frontLeft,
          frontRight: -drag * slip.frontRight,
          backLeft: -drag * slip.backLeft,
          backRight: -drag * slip.backRight,
        },
        HALF_WHEELBASE,
      );
      expect(Math.sign(wrench.fy)).toBe(-Math.sign(vy));
    }
  });
});

describe('forward performance is untouched by the roller term', () => {
  it('leaves the forward wrench identical with and without roller drag', () => {
    const chassis = { vx: 1.2, vy: 0, omega: 0 };
    const withDrag = solve(spec(), chassis, 0, 1);
    const without = solve(spec({ rollerDrag: 0 }), chassis, 0, 1);

    expect(withDrag.wrench.fx).toBeCloseTo(without.wrench.fx, 12);
    expect(withDrag.wrench.fy).toBeCloseTo(without.wrench.fy, 12);
    expect(withDrag.wrench.mz).toBeCloseTo(without.wrench.mz, 12);
  });

  it('leaves forward free speed and peak acceleration unchanged', () => {
    expect(analyticFreeSpeed(spec(), NOMINAL)).toBe(analyticFreeSpeed(spec({ rollerDrag: 0 }), NOMINAL));
    expect(analyticPeakAcceleration(spec(), NOMINAL, MASS_KG)).toBe(
      analyticPeakAcceleration(spec({ rollerDrag: 0 }), NOMINAL, MASS_KG),
    );
  });

  /** At rest the rollers are still, so a standing start is identical too. */
  it('applies no drag from rest', () => {
    const rest = { vx: 0, vy: 0, omega: 0 };
    const withDrag = solve(spec(), rest, 1);
    const without = solve(spec({ rollerDrag: 0 }), rest, 1);
    expect(withDrag.wrench.fy).toBeCloseTo(without.wrench.fy, 12);
  });
});

describe('strafe performance', () => {
  it('settles below forward free speed', () => {
    const forward = analyticFreeSpeed(spec(), NOMINAL);
    const strafe = analyticStrafeFreeSpeed(spec(), NOMINAL);

    expect(strafe).toBeLessThan(forward);
    expect(strafe / forward).toBeCloseTo(0.8, 2);
  });

  /**
   * With the roller term removed the model must return exactly to the ideal
   * mecanum result. That is what makes this an addition to the physics rather
   * than a replacement for part of it.
   */
  it('reduces to the ideal mecanum answer when roller drag is zero', () => {
    const ideal = spec({ rollerDrag: 0 });
    expect(analyticStrafeFreeSpeed(ideal, NOMINAL)).toBeCloseTo(analyticFreeSpeed(ideal, NOMINAL), 12);
    expect(analyticSpinRate(ideal, NOMINAL)).toBeCloseTo(
      analyticFreeSpeed(ideal, NOMINAL) / ideal.kinematicK,
      12,
    );
  });

  it('gets slower as roller drag rises, and never faster than ideal', () => {
    const speeds = [0, 1, 3.757, 8, 20].map((rollerDrag) =>
      analyticStrafeFreeSpeed(spec({ rollerDrag }), NOMINAL),
    );

    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeLessThan(speeds[i - 1] as number);
    }
    expect(speeds[0]).toBeCloseTo(analyticFreeSpeed(spec(), NOMINAL), 12);
  });

  /**
   * The drag is a resistance, not a speed cap: a robot that is over its lateral
   * settling speed is pushed back down to it, and one under is pulled up.
   */
  it('produces a restoring lateral force either side of the settling speed', () => {
    const settled = analyticStrafeFreeSpeed(spec(), NOMINAL);

    expect(solve(spec(), { vx: 0, vy: settled * 0.5, omega: 0 }, 1).wrench.fy).toBeGreaterThan(0);
    expect(solve(spec(), { vx: 0, vy: settled, omega: 0 }, 1).wrench.fy).toBeCloseTo(0, 6);
    expect(solve(spec(), { vx: 0, vy: settled * 1.5, omega: 0 }, 1).wrench.fy).toBeLessThan(0);
  });
});

describe('rotation', () => {
  it('settles below the pure-kinematic spin rate', () => {
    const kinematic = analyticFreeSpeed(spec(), NOMINAL) / spec().kinematicK;
    expect(analyticSpinRate(spec(), NOMINAL)).toBeLessThan(kinematic);
  });

  it('damps yaw in the direction that opposes it', () => {
    for (const omega of [-2, 2]) {
      const slip = rollerSlipSpeeds({ vx: 0, vy: 0, omega }, HALF_WHEELBASE);
      const drag = MECANUM_ROLLER_DRAG_N_PER_MPS;
      const wrench = rollerForcesToChassisWrench(
        {
          frontLeft: -drag * slip.frontLeft,
          frontRight: -drag * slip.frontRight,
          backLeft: -drag * slip.backLeft,
          backRight: -drag * slip.backRight,
        },
        HALF_WHEELBASE,
      );
      expect(Math.sign(wrench.mz)).toBe(-Math.sign(omega));
    }
  });
});
