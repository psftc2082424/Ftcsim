/**
 * Robot derivation — the single site where physics quantities are computed from
 * the four user-facing chassis parameters.
 *
 * PRODUCT_SPEC.md §4 forbids *asking the user* for centre of mass, moment of
 * inertia, wheelbase, track width, or any friction term. It does not require
 * pretending those quantities do not exist: rotational dynamics need an inertia,
 * and mecanum kinematics need a track and wheelbase. They are derived here,
 * once, from length, width, mass and the drivetrain configuration.
 *
 * Every assumption below has an entry in ASSUMPTIONS.md §1. If a number in this
 * file changes, that ledger changes with it.
 */

import { inchesToMeters, poundsToKilograms } from '../units/convert.js';
import {
  kgMeters2,
  kilograms,
  meters,
  type KgMeters2,
  type Kilograms,
  type Meters,
} from '../units/si.js';
import { createMotorModel, type MotorModel } from '../motor/motorModel.js';
import { getMotorDatasheet } from '../motor/catalog/goBILDA.js';
import { createDrivetrainSpec, type DrivetrainSpec } from '../drive/drivetrain.js';
import {
  centreOfMassOffsetIn,
  deriveMechanisms,
  portBudget,
  type DerivedMechanism,
  type PortBudget,
} from '../mechanism/mechanism.js';
import type { RobotConfig } from './robotConfig.js';

/**
 * Total reduction of track and wheelbase relative to the robot's outer
 * dimensions, in metres. 0.0635 m = 2.5 in.
 *
 * A goBILDA 96 mm mecanum wheel is about 38 mm wide, and in a typical FTC build
 * it sits inboard of a side rail, putting the wheel centreline roughly 1.25 in
 * inside each outer face. See ASSUMPTIONS.md §1.1, which also records that this
 * constant affects only rotation rate — never straight-line speed or
 * acceleration — and how to recalibrate it from a measured robot.
 */
export const WHEEL_INSET_M = 0.0635;

/**
 * Numerical floor for a derived half-dimension. Purely a guard against a robot
 * configured smaller than `WHEEL_INSET_M`, which would otherwise drive
 * `kinematicK` to zero and divide by it. Reaching it is reported, never silent.
 * See ASSUMPTIONS.md §1.2.
 */
export const MIN_HALF_DIMENSION_M = 0.01;

const MECANUM_WHEEL_COUNT = 4;

export interface DerivedRobot {
  readonly config: RobotConfig;

  // --- Geometry, SI ---
  readonly lengthM: Meters;
  readonly widthM: Meters;
  readonly heightM: Meters;

  // --- Inertial ---
  /** Chassis plus every mechanism. This is what the physics accelerates. */
  readonly massKg: Kilograms;
  /** Chassis alone, for showing the user where the mass went. */
  readonly chassisMassKg: Kilograms;
  readonly mechanismMassKg: Kilograms;
  /** Uniform rectangular plate: m(L² + W²)/12. ASSUMPTIONS.md §1.3. */
  readonly inertiaZ: KgMeters2;
  /** Mass-weighted offset from the chassis centroid, metres. ASSUMPTIONS.md §1.4. */
  readonly comOffset: { readonly xM: number; readonly yM: number };

  // --- Mechanisms ---
  readonly mechanisms: readonly DerivedMechanism[];
  /** Drivetrain + mechanism motors against the eight available ports. */
  readonly ports: PortBudget;

  // --- Drivetrain geometry ---
  readonly halfTrack: Meters;
  readonly halfWheelbase: Meters;
  /** `halfTrack + halfWheelbase`, the mecanum translation/rotation coupling. */
  readonly kinematicK: number;
  readonly wheelRadius: Meters;

  readonly motor: MotorModel;
  readonly drivetrain: DrivetrainSpec;

  /**
   * True when a half-dimension hit `MIN_HALF_DIMENSION_M`, i.e. the robot is
   * physically too small for its own wheels. Surfaced so the UI can flag an
   * unphysical configuration rather than quietly simulating one.
   */
  readonly geometryClamped: boolean;
}

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number, got ${value}.`);
  }
}

export function deriveRobot(config: RobotConfig): DerivedRobot {
  const { chassis, drivetrain } = config;

  requirePositive(chassis.lengthIn, 'Chassis length');
  requirePositive(chassis.widthIn, 'Chassis width');
  requirePositive(chassis.heightIn, 'Chassis height');
  requirePositive(chassis.massLb, 'Chassis mass');
  requirePositive(drivetrain.gearRatio, 'Drivetrain gear ratio');
  requirePositive(drivetrain.wheelDiameterIn, 'Wheel diameter');

  if (!Number.isInteger(drivetrain.motorCount) || drivetrain.motorCount <= 0) {
    throw new Error(`Motor count must be a positive integer, got ${drivetrain.motorCount}.`);
  }
  if (drivetrain.motorCount % MECANUM_WHEEL_COUNT !== 0) {
    throw new Error(
      `A mecanum drivetrain has ${MECANUM_WHEEL_COUNT} wheels, so motor count must be a ` +
        `multiple of ${MECANUM_WHEEL_COUNT}; got ${drivetrain.motorCount}.`,
    );
  }

  const lengthM = inchesToMeters(chassis.lengthIn);
  const widthM = inchesToMeters(chassis.widthIn);
  const heightM = inchesToMeters(chassis.heightIn);

  // Total mass is derived, never entered twice: a heavier mechanism really does
  // cost acceleration, which is where PRODUCT_SPEC.md §11's tradeoffs come from.
  const mechanisms = deriveMechanisms(config.mechanisms);
  const chassisMassKg = poundsToKilograms(chassis.massLb);
  const mechanismMassKg = poundsToKilograms(mechanisms.massLb);
  const massKg = kilograms(chassisMassKg + mechanismMassKg);

  const comOffsetIn = centreOfMassOffsetIn(chassis.massLb, mechanisms.derived);

  const rawHalfTrack = (widthM - WHEEL_INSET_M) / 2;
  const rawHalfWheelbase = (lengthM - WHEEL_INSET_M) / 2;
  const geometryClamped =
    rawHalfTrack < MIN_HALF_DIMENSION_M || rawHalfWheelbase < MIN_HALF_DIMENSION_M;

  const halfTrack = meters(Math.max(rawHalfTrack, MIN_HALF_DIMENSION_M));
  const halfWheelbase = meters(Math.max(rawHalfWheelbase, MIN_HALF_DIMENSION_M));
  const kinematicK = halfTrack + halfWheelbase;

  const wheelRadius = meters(inchesToMeters(drivetrain.wheelDiameterIn) / 2);
  const motor = createMotorModel(getMotorDatasheet(drivetrain.motorId));

  return {
    config,
    lengthM,
    widthM,
    heightM,
    massKg,
    chassisMassKg,
    mechanismMassKg,
    inertiaZ: kgMeters2((massKg * (lengthM * lengthM + widthM * widthM)) / 12),
    comOffset: {
      xM: inchesToMeters(comOffsetIn.xIn),
      yM: inchesToMeters(comOffsetIn.yIn),
    },
    mechanisms: mechanisms.derived,
    ports: portBudget(drivetrain.motorCount, mechanisms.motorCount),
    halfTrack,
    halfWheelbase,
    kinematicK,
    wheelRadius,
    motor,
    drivetrain: createDrivetrainSpec({
      motor,
      gearRatio: drivetrain.gearRatio,
      wheelRadius,
      kinematicK,
      motorsPerWheel: drivetrain.motorCount / MECANUM_WHEEL_COUNT,
    }),
    geometryClamped,
  };
}
