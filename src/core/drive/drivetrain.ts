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
  type RadPerSec,
  type Volts,
} from '../units/si.js';
import { motorCurrent, motorTorque, type MotorModel } from '../motor/motorModel.js';
import { sumPackLoad } from '../motor/battery.js';
import {
  chassisToWheelVelocities,
  commandToWheels,
  rollerForcesToChassisWrench,
  rollerSlipSpeeds,
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

/**
 * Resistance in the roller path, newtons per metre/second of roller slip.
 *
 * A mecanum wheel's rollers are small, barrel-shaped and carried on short
 * bearings. Turning them costs something: bearing drag, and a contact patch that
 * scrubs rather than rolls cleanly. `rollerSlipSpeeds` shows that this cost is
 * geometrically confined to lateral motion — a mecanum wheel driving straight
 * ahead does not turn its rollers at all — so one scalar here is enough to make
 * strafing slower than driving without touching forward performance at all.
 *
 * **This is the only invented number in the drivetrain, and it is a
 * transmission loss, not a traction limit.** `IdealTraction` remains the
 * identity function and no friction coefficient exists anywhere; what this adds
 * is a resistance *inside* the drivetrain, a sibling of
 * `DRIVETRAIN_EFFICIENCY`. Top speed stays emergent: the robot accelerates until
 * motor force balances roller drag, and nothing anywhere reads a maximum speed.
 *
 * The value puts the reference robot at a strafe/forward top-speed ratio of
 * 0.80. Calibrate it from a measured robot with
 *
 *     c = (kT kE G^2 eta / (2 R r^2)) * (v_forward / v_strafe - 1)
 *
 * See ASSUMPTIONS.md §2.2.
 */
export const MECANUM_ROLLER_DRAG_N_PER_MPS = 3.757;

export interface DrivetrainSpec {
  readonly motor: MotorModel;
  /** External reduction between motor output shaft and wheel. >1 is a reduction. */
  readonly gearRatio: number;
  readonly wheelRadius: Meters;
  /** `halfTrack + halfWheelbase`, from `robot/derive.ts`. */
  readonly kinematicK: number;
  /**
   * Half the wheelbase, from `robot/derive.ts`.
   *
   * Separate from `kinematicK` because roller slip depends on the wheelbase
   * alone, where the hub kinematics depend on the sum of half-track and
   * half-wheelbase. Two different geometric facts about the same chassis.
   */
  readonly halfWheelbase: number;
  readonly efficiency: number;
  /** Roller-path resistance, N per m/s of roller slip. */
  readonly rollerDrag: number;
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
  halfWheelbase?: number;
  efficiency?: number;
  motorsPerWheel?: number;
  rollerDrag?: number;
}): DrivetrainSpec {
  if (params.gearRatio <= 0) throw new Error('Drivetrain gear ratio must be positive.');
  if (params.wheelRadius <= 0) throw new Error('Wheel radius must be positive.');
  if (params.kinematicK <= 0) throw new Error('Kinematic k must be positive.');

  // A square chassis has half-track equal to half-wheelbase, so half of k is the
  // right default for a caller that only knows the coupling constant.
  const halfWheelbase = params.halfWheelbase ?? params.kinematicK / 2;
  if (halfWheelbase <= 0) throw new Error('Half wheelbase must be positive.');

  const rollerDrag = params.rollerDrag ?? MECANUM_ROLLER_DRAG_N_PER_MPS;
  if (rollerDrag < 0) throw new Error('Roller drag cannot be negative.');

  const motorsPerWheel = params.motorsPerWheel ?? 1;
  if (motorsPerWheel <= 0) throw new Error('Motors per wheel must be positive.');

  return {
    motor: params.motor,
    gearRatio: params.gearRatio,
    wheelRadius: params.wheelRadius,
    kinematicK: params.kinematicK,
    halfWheelbase,
    efficiency: params.efficiency ?? DRIVETRAIN_EFFICIENCY,
    rollerDrag,
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
  const driveWrench = wheelForcesToChassisWrench(wheelForces, spec.kinematicK);

  // 7. The rollers. Turning them costs something, and the geometry says how much
  //    of the motion goes through them — none of it when driving straight ahead,
  //    all of it when strafing. Mapped back by its own Jacobian transpose so the
  //    result cannot inject energy.
  const rollerSlip = rollerSlipSpeeds(chassis, spec.halfWheelbase);
  const rollerForces = mapWheels(rollerSlip, (slip) => -spec.rollerDrag * slip);
  const rollerWrench = rollerForcesToChassisWrench(rollerForces, spec.halfWheelbase);

  const wrench = {
    fx: driveWrench.fx + rollerWrench.fx,
    fy: driveWrench.fy + rollerWrench.fy,
    mz: driveWrench.mz + rollerWrench.mz,
  };

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
 * Analytic *lateral* free speed: where lateral motor force balances roller drag.
 *
 * Forward free speed is where motor torque reaches zero. Strafing never gets
 * there, because the rollers are turning and resisting the whole way, so the
 * robot settles earlier:
 *
 *     4 * kT (V - kE * vy * G / r) * G * eta / (R r)  =  8 * c * vy
 *
 * Solving for `vy` gives the value below. With `c = 0` it reduces exactly to
 * `analyticFreeSpeed`, which is the check that the roller term is an addition to
 * the model rather than a replacement for part of it.
 */
export function analyticStrafeFreeSpeed(
  spec: DrivetrainSpec,
  batteryVolts: Volts,
  duty = 1,
): MetersPerSec {
  const forcePerVolt =
    (4 * spec.motor.kT * spec.gearRatio * spec.efficiency * spec.motorsPerWheel) /
    (spec.motor.resistance * spec.wheelRadius);
  const backEmfPerSpeed = (spec.motor.kE * spec.gearRatio) / spec.wheelRadius;

  const numerator = forcePerVolt * duty * batteryVolts;
  const denominator = 8 * spec.rollerDrag + forcePerVolt * backEmfPerSpeed;
  return metersPerSec(numerator / denominator);
}

/**
 * Analytic steady spin rate, where yaw motor torque balances roller drag.
 *
 * Spinning in place moves every contact patch sideways, so the rollers turn and
 * resist exactly as they do in a strafe. The robot settles where
 *
 *     4 k * kT (V - kE k omega G / r) G eta n / (R r)  =  8 c a^2 omega
 *
 * With `c = 0` this reduces to `v_free / k`, the pure-kinematic answer.
 */
export function analyticSpinRate(
  spec: DrivetrainSpec,
  batteryVolts: Volts,
  duty = 1,
): RadPerSec {
  const torquePerVolt =
    (4 * spec.kinematicK * spec.motor.kT * spec.gearRatio * spec.efficiency * spec.motorsPerWheel) /
    (spec.motor.resistance * spec.wheelRadius);
  const backEmfPerRate = (spec.motor.kE * spec.kinematicK * spec.gearRatio) / spec.wheelRadius;

  const rollerResistance = 8 * spec.rollerDrag * spec.halfWheelbase * spec.halfWheelbase;
  return radPerSec(
    (torquePerVolt * duty * batteryVolts) / (rollerResistance + torquePerVolt * backEmfPerRate),
  );
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
