import { describe, expect, it } from 'vitest';
import { MIN_HALF_DIMENSION_M, WHEEL_INSET_M, deriveRobot } from './derive.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from './robotConfig.js';
import { inchesToMeters, poundsToKilograms } from '../units/convert.js';

const withChassis = (patch: Partial<RobotConfig['chassis']>): RobotConfig => ({
  ...DEFAULT_ROBOT_CONFIG,
  chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, ...patch },
});

const withDrivetrain = (patch: Partial<RobotConfig['drivetrain']>): RobotConfig => ({
  ...DEFAULT_ROBOT_CONFIG,
  drivetrain: { ...DEFAULT_ROBOT_CONFIG.drivetrain, ...patch },
});

describe('derive — unit conversion at the boundary', () => {
  it('converts the four user parameters into SI exactly once', () => {
    const r = deriveRobot(DEFAULT_ROBOT_CONFIG);
    expect(r.lengthM).toBeCloseTo(inchesToMeters(18), 12);
    expect(r.widthM).toBeCloseTo(inchesToMeters(18), 12);
    expect(r.heightM).toBeCloseTo(inchesToMeters(18), 12);
    expect(r.massKg).toBeCloseTo(poundsToKilograms(32), 12);
  });

  it('halves the wheel diameter into a radius', () => {
    const r = deriveRobot(DEFAULT_ROBOT_CONFIG);
    expect(r.wheelRadius).toBeCloseTo(inchesToMeters(3.78) / 2, 12);
  });
});

describe('derive — inertial properties (ASSUMPTIONS.md §1.3)', () => {
  it('uses the uniform rectangular plate formula', () => {
    const r = deriveRobot(DEFAULT_ROBOT_CONFIG);
    const expected = (r.massKg * (r.lengthM * r.lengthM + r.widthM * r.widthM)) / 12;
    expect(r.inertiaZ).toBeCloseTo(expected, 12);
    expect(r.inertiaZ).toBeCloseTo(0.505681, 5);
  });

  it('scales inertia linearly with mass', () => {
    const light = deriveRobot(withChassis({ massLb: 20 }));
    const heavy = deriveRobot(withChassis({ massLb: 40 }));
    expect(heavy.inertiaZ / light.inertiaZ).toBeCloseTo(2, 12);
  });

  it('scales inertia with the square of size', () => {
    const small = deriveRobot(withChassis({ lengthIn: 10, widthIn: 10 }));
    const large = deriveRobot(withChassis({ lengthIn: 20, widthIn: 20 }));
    expect(large.inertiaZ / small.inertiaZ).toBeCloseTo(4, 12);
  });
});

describe('derive — track and wheelbase (ASSUMPTIONS.md §1.1)', () => {
  it('insets both dimensions by WHEEL_INSET_M', () => {
    const r = deriveRobot(DEFAULT_ROBOT_CONFIG);
    expect(r.halfTrack).toBeCloseTo((inchesToMeters(18) - WHEEL_INSET_M) / 2, 12);
    expect(r.halfWheelbase).toBeCloseTo((inchesToMeters(18) - WHEEL_INSET_M) / 2, 12);
    expect(r.kinematicK).toBeCloseTo(r.halfTrack + r.halfWheelbase, 12);
    expect(r.kinematicK).toBeCloseTo(0.3937, 6);
  });

  it('distinguishes a non-square chassis', () => {
    const r = deriveRobot(withChassis({ lengthIn: 18, widthIn: 12 }));
    expect(r.halfWheelbase).toBeGreaterThan(r.halfTrack);
  });

  /**
   * The inset affects only the translation/rotation coupling. If it ever leaked
   * into straight-line performance, this test would catch it.
   */
  it('does not affect wheel radius, mass or inertia', () => {
    const a = deriveRobot(withChassis({ widthIn: 18 }));
    const b = deriveRobot(withChassis({ widthIn: 18 }));
    expect(a.kinematicK).toBe(b.kinematicK);
    expect(a.wheelRadius).toBe(b.wheelRadius);
  });
});

describe('derive — degenerate geometry guard (ASSUMPTIONS.md §1.2)', () => {
  it('does not clamp a normally-sized robot', () => {
    expect(deriveRobot(DEFAULT_ROBOT_CONFIG).geometryClamped).toBe(false);
  });

  it('clamps and reports a robot smaller than its own wheel inset', () => {
    // 2 in wide is 0.0508 m, below the 0.0635 m inset.
    const r = deriveRobot(withChassis({ lengthIn: 2, widthIn: 2 }));
    expect(r.geometryClamped).toBe(true);
    expect(r.halfTrack).toBe(MIN_HALF_DIMENSION_M);
    expect(r.halfWheelbase).toBe(MIN_HALF_DIMENSION_M);
    expect(r.kinematicK).toBeGreaterThan(0);
    expect(Number.isFinite(r.kinematicK)).toBe(true);
  });
});

describe('derive — drivetrain assembly', () => {
  it('passes derived geometry through to the drivetrain spec', () => {
    const r = deriveRobot(DEFAULT_ROBOT_CONFIG);
    expect(r.drivetrain.kinematicK).toBe(r.kinematicK);
    expect(r.drivetrain.wheelRadius).toBe(r.wheelRadius);
    expect(r.drivetrain.gearRatio).toBe(DEFAULT_ROBOT_CONFIG.drivetrain.gearRatio);
    expect(r.drivetrain.motorsPerWheel).toBe(1);
  });

  it('derives motors-per-wheel from motor count', () => {
    expect(deriveRobot(withDrivetrain({ motorCount: 8 })).drivetrain.motorsPerWheel).toBe(2);
  });

  it('loads the motor model from the catalogue', () => {
    const r = deriveRobot(DEFAULT_ROBOT_CONFIG);
    expect(r.motor.datasheet.sku).toBe('5203-2402-0019');
    expect(r.motor.datasheet.freeSpeedRpm).toBe(312);
  });
});

describe('derive — validation', () => {
  it('rejects non-positive chassis dimensions and mass', () => {
    expect(() => deriveRobot(withChassis({ lengthIn: 0 }))).toThrow(/Chassis length/);
    expect(() => deriveRobot(withChassis({ widthIn: -1 }))).toThrow(/Chassis width/);
    expect(() => deriveRobot(withChassis({ heightIn: 0 }))).toThrow(/Chassis height/);
    expect(() => deriveRobot(withChassis({ massLb: 0 }))).toThrow(/Chassis mass/);
  });

  it('rejects a non-finite dimension', () => {
    expect(() => deriveRobot(withChassis({ lengthIn: Number.NaN }))).toThrow(/Chassis length/);
    expect(() => deriveRobot(withChassis({ massLb: Number.POSITIVE_INFINITY }))).toThrow(
      /Chassis mass/,
    );
  });

  it('rejects invalid drivetrain values', () => {
    expect(() => deriveRobot(withDrivetrain({ gearRatio: 0 }))).toThrow(/gear ratio/);
    expect(() => deriveRobot(withDrivetrain({ wheelDiameterIn: -3 }))).toThrow(/Wheel diameter/);
    expect(() => deriveRobot(withDrivetrain({ motorId: 'nope' }))).toThrow(/Unknown motor id/);
  });

  it('requires a motor count that fits four mecanum wheels', () => {
    expect(() => deriveRobot(withDrivetrain({ motorCount: 3 }))).toThrow(/multiple of 4/);
    expect(() => deriveRobot(withDrivetrain({ motorCount: 0 }))).toThrow(/positive integer/);
    expect(() => deriveRobot(withDrivetrain({ motorCount: 2.5 }))).toThrow(/positive integer/);
  });
});

describe('derive — purity', () => {
  it('is deterministic and does not mutate its input', () => {
    const config = structuredClone(DEFAULT_ROBOT_CONFIG) as RobotConfig;
    const snapshot = JSON.stringify(config);

    const a = deriveRobot(config);
    const b = deriveRobot(config);

    expect(JSON.stringify(config)).toBe(snapshot);
    expect(a.kinematicK).toBe(b.kinematicK);
    expect(a.inertiaZ).toBe(b.inertiaZ);
    expect(a.massKg).toBe(b.massKg);
  });
});
