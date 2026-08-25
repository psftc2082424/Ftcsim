/**
 * Force-based mecanum drivetrain (ARCHITECTURE.md §5.3).
 *
 * The chain is physical end to end:
 *
 *     command -> wheel duty (saturated)
 *     chassis velocity -> wheel speed -> motor speed        (no slip)
 *     motor speed + duty + battery volts -> motor torque
 *     motor torque -> wheel force -> body wrench -> acceleration
 *
 * Nothing in this module reads a maximum speed or a maximum acceleration,
 * because no such parameter exists anywhere in the simulator. Top speed emerges:
 * as the robot accelerates, back-EMF grows until motor torque falls to zero, and
 * that is where it settles. Acceleration emerges the same way, from stall torque
 * at zero speed.
 */

import {
  amps,
  metersPerSec,
  metersPerSec2,
  radPerSec,
  type Amps,
  type Meters,
  type MetersPerSec,
  type MetersPerSec2,
  type Volts,
} from '../units/si.js';
import { motorCurrent, motorTorque, type MotorModel } from '../motor/motorModel.js';
import { sumPackLoad } from '../motor/battery.js';
import {
  chassisToWheelVelocities,
  commandToWheels,
  mapWheels,
  saturate,
  toArray,
  wheelForcesToChassisWrench,
  zipWheels,
  type ChassisVelocity,
  type ChassisWrench,
  type WheelValues,
} from './mecanumKinematics.js';
import type { TractionModel } from './traction.js';

/**
 * External transmission efficiency, motor output shaft to wheel.
 *
 * PRODUCT_SPEC.md §5 specifies a belted drivetrain; a single synchronous-belt
 * stage transmits roughly 95–98 % of input power. This covers the belt only —
 * the motor's internal planetary losses are already inside the catalogued stall
 * torque, and applying a gearbox efficiency here as well would count them twice
 * (ASSUMPTIONS.md §2.3).
 *
 * Applied multiplicatively in both directions. During regenerative braking the
 * strictly correct form divides rather than multiplies, which would understate
 * braking force by about 10 %; the multiplicative form is used because it is
 * continuous and monotonic through zero torque, and a sign branch there would
 * introduce chatter at low speed for a second-order gain (ASSUMPTIONS.md §2.5).
 */
export const DRIVETRAIN_EFFICIENCY = 0.95;

export interface DrivetrainSpec {
  readonly motor: MotorModel;
  /** External reduction between motor output shaft and wheel. >1 is a reduction. */
  readonly gearRatio: number;
  readonly wheelRadius: Meters;
  /** `halfTrack + halfWheelbase`, from `robot/derive.ts`. */
  readonly kinematicK: number;
  readonly efficiency: number;
  /**
   * Drive motors per wheel, `motorCount / 4`. Normally 1. Two motors geared to
   * one wheel double the torque available at that contact patch without
   * changing its free speed, which is exactly how the model treats it.
   */
  readonly motorsPerWheel: number;
}

export interface DriveCommand {
  /** Forward, [-1, 1]. */
  readonly x: number;
  /** Left, [-1, 1]. */
  readonly y: number;
  /** Counter-clockwise, [-1, 1]. */
  readonly turn: number;
}

export interface DrivetrainSolution {
  /** Body-frame force and torque to hand to the integrator. */
  readonly wrench: ChassisWrench;
  /** Saturated per-wheel duty cycles. */
  readonly wheelDuties: WheelValues;
  /** Motor output-shaft speeds, rad/s. */
  readonly motorSpeeds: WheelValues;
  /** Motor output-shaft torques, N·m. */
  readonly motorTorques: WheelValues;
  /** Signed per-motor current, A. Negative while regenerating. */
  readonly motorCurrents: WheelValues;
  /** Contact-patch forces after the traction model, N. */
  readonly wheelForces: WheelValues;
  /** Pack load for the battery's end-of-tick update, A. */
  readonly totalCurrent: Amps;
}

export function createDrivetrainSpec(params: {
  motor: MotorModel;
  gearRatio: number;
  wheelRadius: Meters;
  kinematicK: number;
  efficiency?: number;
  motorsPerWheel?: number;
}): DrivetrainSpec {
  if (params.gearRatio <= 0) throw new Error('Drivetrain gear ratio must be positive.');
  if (params.wheelRadius <= 0) throw new Error('Wheel radius must be positive.');
  if (params.kinematicK <= 0) throw new Error('Kinematic k must be positive.');

  const motorsPerWheel = params.motorsPerWheel ?? 1;
  if (motorsPerWheel <= 0) throw new Error('Motors per wheel must be positive.');

  return {
    motor: params.motor,
    gearRatio: params.gearRatio,
    wheelRadius: params.wheelRadius,
    kinematicK: params.kinematicK,
    efficiency: params.efficiency ?? DRIVETRAIN_EFFICIENCY,
    motorsPerWheel,
  };
}

/**
 * Solve one tick of drivetrain dynamics.
 *
 * `batteryVolts` is the previous tick's terminal voltage — the one-tick lag that
 * breaks the torque/current/voltage algebraic loop (ARCHITECTURE.md §5.2).
 */
export function solveDrivetrain(
  spec: DrivetrainSpec,
  chassis: ChassisVelocity,
  command: DriveCommand,
  batteryVolts: Volts,
  traction: TractionModel,
  massKg: number,
): DrivetrainSolution {
  // 1. Driver command -> per-wheel duty, normalised so direction survives.
  const wheelDuties = saturate(commandToWheels(command.x, command.y, command.turn));

  // 2. Perfect traction means no slip, so chassis motion fixes wheel speed, and
  //    wheel speed fixes where each motor sits on its torque-speed curve.
  const wheelLinearVelocities = chassisToWheelVelocities(chassis, spec.kinematicK);
  const motorSpeeds = mapWheels(
    wheelLinearVelocities,
    (v) => (v / spec.wheelRadius) * spec.gearRatio,
  );

  // 3. Torque and current at each motor, from the datasheet-calibrated model.
  const motorTorques = zipWheels(motorSpeeds, wheelDuties, (omega, duty) =>
    motorTorque(spec.motor, radPerSec(omega), duty, batteryVolts),
  );

  const motorCurrents = zipWheels(motorSpeeds, wheelDuties, (omega, duty) =>
    motorCurrent(spec.motor, radPerSec(omega), duty, batteryVolts),
  );

  // 4. Torque at the motor becomes force at the contact patch.
  const rawWheelForces = mapWheels(
    motorTorques,
    (tau) => (tau * spec.motorsPerWheel * spec.gearRatio * spec.efficiency) / spec.wheelRadius,
  );

  // 5. Phase 1: the identity function. The seam exists for a future calibrated
  //    mode and applies no clamp of any kind today.
  const wheelForces = traction.limit(rawWheelForces, { massKg, chassis });

  // 6. Jacobian transpose back into the body frame.
  const wrench = wheelForcesToChassisWrench(wheelForces, spec.kinematicK);

  return {
    wrench,
    wheelDuties,
    motorSpeeds,
    motorTorques,
    motorCurrents,
    wheelForces,
    // Each wheel may be driven by more than one motor; the pack sees them all.
    totalCurrent: sumPackLoad(
      toArray(motorCurrents).map((i) => amps(i * spec.motorsPerWheel)),
    ),
  };
}

/**
 * Analytic free speed: the straight-line speed at which forward motor torque
 * reaches zero, so the robot stops accelerating.
 *
 *     v = omega_free_effective * r / G
 *
 * This is the closed-form answer the simulation must converge to, and the
 * reference the drivetrain tests measure against. It is a *prediction used for
 * verification*, never an input to the simulation.
 */
export function analyticFreeSpeed(
  spec: DrivetrainSpec,
  batteryVolts: Volts,
  duty = 1,
): MetersPerSec {
  const motorOmega = (duty * batteryVolts) / spec.motor.kE;
  return metersPerSec((motorOmega * spec.wheelRadius) / spec.gearRatio);
}

/**
 * Analytic acceleration from rest at full forward command, four wheels driving:
 *
 *     a = 4 * tau_stall * G * eta / (r * m)
 *
 * Stall-torque-limited, because Phase 1 traction is ideal (ASSUMPTIONS.md §2.1).
 */
export function analyticPeakAcceleration(
  spec: DrivetrainSpec,
  batteryVolts: Volts,
  massKg: number,
): MetersPerSec2 {
  const stallTorqueAtVoltage = spec.motor.kT * (batteryVolts / spec.motor.resistance);
  const forcePerWheel =
    (stallTorqueAtVoltage * spec.motorsPerWheel * spec.gearRatio * spec.efficiency) /
    spec.wheelRadius;
  return metersPerSec2((4 * forcePerWheel) / massKg);
}
