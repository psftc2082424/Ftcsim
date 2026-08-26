import { describe, expect, it } from 'vitest';
import {
  DRIVETRAIN_EFFICIENCY,
  analyticFreeSpeed,
  analyticPeakAcceleration,
  createDrivetrainSpec,
  solveDrivetrain,
  type DrivetrainSpec,
} from './drivetrain.js';
import { IdealTraction } from './traction.js';
import { toArray, type ChassisVelocity } from './mecanumKinematics.js';
import { createMotorModel } from '../motor/motorModel.js';
import { getMotorDatasheet } from '../motor/catalog/goBILDA.js';
import { asVolts, inchesToMeters, metersPerSecToFeetPerSec, poundsToKilograms } from '../units/convert.js';
import { meters } from '../units/si.js';

const NOMINAL = asVolts(12);
const REST: ChassisVelocity = { vx: 0, vy: 0, omega: 0 };

/** The default FTC robot: 4 x 312 RPM, 1:1, 96 mm (3.78 in) mecanum, 32 lb. */
function defaultSpec(): DrivetrainSpec {
  return createDrivetrainSpec({
    motor: createMotorModel(getMotorDatasheet('gobilda-5203-312')),
    gearRatio: 1,
    wheelRadius: meters(inchesToMeters(3.78) / 2),
    kinematicK: 0.3937,
  });
}

const DEFAULT_MASS_KG = poundsToKilograms(32);

const solve = (
  spec: DrivetrainSpec,
  chassis: ChassisVelocity,
  x: number,
  y: number,
  turn: number,
  volts = NOMINAL,
  mass: number = DEFAULT_MASS_KG,
) => solveDrivetrain(spec, chassis, { x, y, turn }, volts, IdealTraction, mass);

describe('drivetrain — analytic reference (hand-computed)', () => {
  /**
   * These two numbers were computed by hand from the datasheet before the code
   * was written, so they check the whole chain — unit conversion, motor
   * constants, gearing, wheel radius and the wrench mapping — rather than the
   * code checking itself.
   */
  it('predicts 5.15 ft/s free speed for the default robot', () => {
    const v = analyticFreeSpeed(defaultSpec(), NOMINAL);
    expect(metersPerSecToFeetPerSec(v)).toBeCloseTo(5.146, 2);
  });

  it('predicts 12.996 m/s^2 peak acceleration for the default robot', () => {
    const a = analyticPeakAcceleration(defaultSpec(), NOMINAL, DEFAULT_MASS_KG);
    expect(a).toBeCloseTo(12.9957, 3);
  });

  /**
   * 1.33 g is far beyond what mecanum wheels achieve on FTC foam tile. It is the
   * direct and expected consequence of Phase 1's ideal-traction mandate
   * (PRODUCT_SPEC.md §4, ASSUMPTIONS.md §2.1) — recorded here as a test so the
   * over-prediction stays visible rather than becoming folklore.
   */
  it('is stall-torque-limited, not friction-limited, and exceeds 1 g', () => {
    const a = analyticPeakAcceleration(defaultSpec(), NOMINAL, DEFAULT_MASS_KG);
    expect(a / 9.80665).toBeGreaterThan(1.0);
  });
});

describe('drivetrain — solution matches the analytic reference', () => {
  it('produces exactly the analytic peak force at rest, full forward', () => {
    const spec = defaultSpec();
    const solution = solve(spec, REST, 1, 0, 0);

    const expectedAccel = analyticPeakAcceleration(spec, NOMINAL, DEFAULT_MASS_KG);
    expect(solution.wrench.fx / DEFAULT_MASS_KG).toBeCloseTo(expectedAccel, 9);
    expect(solution.wrench.fy).toBeCloseTo(0, 9);
    expect(solution.wrench.mz).toBeCloseTo(0, 9);
  });

  it('produces zero net force at the analytic free speed', () => {
    const spec = defaultSpec();
    const vFree = analyticFreeSpeed(spec, NOMINAL);
    const solution = solve(spec, { vx: vFree, vy: 0, omega: 0 }, 1, 0, 0);

    expect(solution.wrench.fx).toBeCloseTo(0, 9);
  });

  it('decelerates when driven above free speed', () => {
    const spec = defaultSpec();
    const vFree = analyticFreeSpeed(spec, NOMINAL);
    const solution = solve(spec, { vx: vFree * 1.2, vy: 0, omega: 0 }, 1, 0, 0);

    expect(solution.wrench.fx).toBeLessThan(0);
  });

  it('brakes when the command drops to zero while moving', () => {
    // Deceleration comes from motor back-EMF, not from any drag coefficient.
    const solution = solve(defaultSpec(), { vx: 1.0, vy: 0, omega: 0 }, 0, 0, 0);
    expect(solution.wrench.fx).toBeLessThan(0);
  });

  it('is at rest and force-free with no command', () => {
    const solution = solve(defaultSpec(), REST, 0, 0, 0);
    expect(solution.wrench.fx).toBeCloseTo(0, 12);
    expect(solution.wrench.fy).toBeCloseTo(0, 12);
    expect(solution.wrench.mz).toBeCloseTo(0, 12);
    expect(solution.totalCurrent).toBeCloseTo(0, 12);
  });
});

describe('drivetrain — directional purity', () => {
  it('turns a pure strafe command into pure lateral force', () => {
    const solution = solve(defaultSpec(), REST, 0, 1, 0);
    expect(solution.wrench.fy).toBeGreaterThan(0);
    expect(solution.wrench.fx).toBeCloseTo(0, 9);
    expect(solution.wrench.mz).toBeCloseTo(0, 9);
  });

  it('turns a pure rotation command into pure torque', () => {
    const solution = solve(defaultSpec(), REST, 0, 0, 1);
    expect(solution.wrench.mz).toBeGreaterThan(0);
    expect(solution.wrench.fx).toBeCloseTo(0, 9);
    expect(solution.wrench.fy).toBeCloseTo(0, 9);
  });

  /**
   * The *hub* is symmetric: from rest the Jacobian-transpose force map gives
   * identical force forward and sideways, and that is a real property of ideal
   * 45° mecanum rather than a simplification. What makes strafing slower is the
   * rollers, and from rest they are not turning — so this equality must survive
   * the roller model, and it is where the asymmetry does *not* come from.
   * See `rollerSlip.test.ts` and ASSUMPTIONS.md §2.2.
   */
  it('produces equal forward and lateral force magnitude from rest', () => {
    const forward = solve(defaultSpec(), REST, 1, 0, 0);
    const strafe = solve(defaultSpec(), REST, 0, 1, 0);
    expect(strafe.wrench.fy).toBeCloseTo(forward.wrench.fx, 9);
  });
});

describe('drivetrain — saturation behaviour', () => {
  it('never commands a wheel beyond full duty', () => {
    const solution = solve(defaultSpec(), REST, 1, 1, 1);
    for (const duty of toArray(solution.wheelDuties)) {
      expect(Math.abs(duty)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('preserves commanded direction when saturating', () => {
    // Commanding (1, 1, 0) asks for a 45-degree diagonal; after saturation the
    // force must still be at 45 degrees, only smaller.
    const solution = solve(defaultSpec(), REST, 1, 1, 0);
    expect(solution.wrench.fx).toBeCloseTo(solution.wrench.fy, 9);
    expect(solution.wrench.mz).toBeCloseTo(0, 9);
  });
});

describe('drivetrain — electrical coupling', () => {
  it('draws four motors of stall current at rest, full command', () => {
    const solution = solve(defaultSpec(), REST, 1, 0, 0);
    expect(solution.totalCurrent).toBeCloseTo(4 * 9.2, 6);
  });

  it('draws little current near free speed', () => {
    const spec = defaultSpec();
    const vFree = analyticFreeSpeed(spec, NOMINAL);
    const solution = solve(spec, { vx: vFree * 0.98, vy: 0, omega: 0 }, 1, 0, 0);
    expect(solution.totalCurrent).toBeLessThan(4 * 9.2 * 0.05);
  });

  it('excludes regenerative current from pack load', () => {
    const solution = solve(defaultSpec(), { vx: 1.0, vy: 0, omega: 0 }, 0, 0, 0);
    for (const i of toArray(solution.motorCurrents)) {
      expect(i).toBeLessThan(0); // every motor is regenerating
    }
    expect(solution.totalCurrent).toBe(0); // but the pack is not being charged
  });

  it('produces less force on a sagged battery', () => {
    const spec = defaultSpec();
    const full = solve(spec, REST, 1, 0, 0, asVolts(12));
    const sagged = solve(spec, REST, 1, 0, 0, asVolts(10.5));
    expect(sagged.wrench.fx).toBeLessThan(full.wrench.fx);
    expect(sagged.wrench.fx / full.wrench.fx).toBeCloseTo(10.5 / 12, 6);
  });
});

describe('drivetrain — configuration effects', () => {
  it('multiplies force but not free speed when gearing down', () => {
    const base = defaultSpec();
    const geared = createDrivetrainSpec({
      motor: base.motor,
      gearRatio: 2,
      wheelRadius: base.wheelRadius,
      kinematicK: base.kinematicK,
    });

    expect(analyticFreeSpeed(geared, NOMINAL)).toBeCloseTo(analyticFreeSpeed(base, NOMINAL) / 2, 9);
    expect(analyticPeakAcceleration(geared, NOMINAL, DEFAULT_MASS_KG)).toBeCloseTo(
      analyticPeakAcceleration(base, NOMINAL, DEFAULT_MASS_KG) * 2,
      9,
    );
  });

  it('raises free speed and lowers force with a larger wheel', () => {
    const base = defaultSpec();
    const bigger = createDrivetrainSpec({
      motor: base.motor,
      gearRatio: base.gearRatio,
      wheelRadius: meters(base.wheelRadius * 2),
      kinematicK: base.kinematicK,
    });

    expect(analyticFreeSpeed(bigger, NOMINAL)).toBeCloseTo(analyticFreeSpeed(base, NOMINAL) * 2, 9);
    expect(analyticPeakAcceleration(bigger, NOMINAL, DEFAULT_MASS_KG)).toBeCloseTo(
      analyticPeakAcceleration(base, NOMINAL, DEFAULT_MASS_KG) / 2,
      9,
    );
  });

  it('doubles torque and current with two motors per wheel', () => {
    const base = defaultSpec();
    const doubled = createDrivetrainSpec({
      motor: base.motor,
      gearRatio: base.gearRatio,
      wheelRadius: base.wheelRadius,
      kinematicK: base.kinematicK,
      motorsPerWheel: 2,
    });

    const single = solve(base, REST, 1, 0, 0);
    const dual = solveDrivetrain(
      doubled,
      REST,
      { x: 1, y: 0, turn: 0 },
      NOMINAL,
      IdealTraction,
      DEFAULT_MASS_KG,
    );

    expect(dual.wrench.fx).toBeCloseTo(single.wrench.fx * 2, 9);
    expect(dual.totalCurrent).toBeCloseTo(single.totalCurrent * 2, 9);
    // Free speed is unchanged: more torque, same back-EMF limit.
    expect(analyticFreeSpeed(doubled, NOMINAL)).toBeCloseTo(analyticFreeSpeed(base, NOMINAL), 12);
  });

  it('scales force with the belt efficiency constant', () => {
    const spec = defaultSpec();
    expect(spec.efficiency).toBe(DRIVETRAIN_EFFICIENCY);

    const lossless = createDrivetrainSpec({
      motor: spec.motor,
      gearRatio: spec.gearRatio,
      wheelRadius: spec.wheelRadius,
      kinematicK: spec.kinematicK,
      efficiency: 1,
    });

    const a = solve(spec, REST, 1, 0, 0).wrench.fx;
    const b = solveDrivetrain(
      lossless,
      REST,
      { x: 1, y: 0, turn: 0 },
      NOMINAL,
      IdealTraction,
      DEFAULT_MASS_KG,
    ).wrench.fx;

    expect(a / b).toBeCloseTo(DRIVETRAIN_EFFICIENCY, 9);
  });

  it('rejects an invalid drivetrain specification', () => {
    const motor = createMotorModel(getMotorDatasheet('gobilda-5203-312'));
    const ok = { motor, gearRatio: 1, wheelRadius: meters(0.048), kinematicK: 0.39 };
    expect(() => createDrivetrainSpec({ ...ok, gearRatio: 0 })).toThrow(/gear ratio/);
    expect(() => createDrivetrainSpec({ ...ok, wheelRadius: meters(0) })).toThrow(/Wheel radius/);
    expect(() => createDrivetrainSpec({ ...ok, kinematicK: 0 })).toThrow(/Kinematic k/);
    expect(() => createDrivetrainSpec({ ...ok, motorsPerWheel: 0 })).toThrow(/Motors per wheel/);
  });
});

describe('drivetrain — ideal traction is exactly the identity', () => {
  it('leaves wheel forces untouched', () => {
    const spec = defaultSpec();
    const solution = solve(spec, REST, 1, 0, 0);

    // Recompute the pre-traction force by hand; nothing may have been clamped.
    const expectedPerWheel =
      (solution.motorTorques.frontLeft * spec.motorsPerWheel * spec.gearRatio * spec.efficiency) /
      spec.wheelRadius;

    expect(solution.wheelForces.frontLeft).toBeCloseTo(expectedPerWheel, 12);
    expect(IdealTraction.id).toBe('ideal');
  });

  it('imposes no upper bound on force as mass falls', () => {
    // A friction-limited model would cap acceleration; a stall-torque-limited
    // one does not. This asserts Phase 1 has no hidden clamp.
    const spec = defaultSpec();
    const light = solve(spec, REST, 1, 0, 0, NOMINAL, 1);
    const heavy = solve(spec, REST, 1, 0, 0, NOMINAL, 100);
    expect(light.wrench.fx).toBeCloseTo(heavy.wrench.fx, 12);
  });
});
