/**
 * Flywheel dynamics for a launcher.
 *
 * A shooter is a rotating mass driven by the *same* motor model the drivetrain
 * uses (`motor/motorModel.ts`). Nothing here is a timing constant: spin-up time,
 * the speed a shot leaves at, and how long the wheel takes to recover between
 * shots all fall out of inertia, torque and energy.
 *
 * ── The chain, end to end ──────────────────────────────────────────────────
 *
 *   motor torque  ->  angular acceleration  ->  surface speed  ->  exit speed
 *        ^                                                            |
 *        |                    energy taken by the ball  <-------------+
 *
 * `tau = kT (duty * V - kE * w) / R` is the motor. Divided by the flywheel's
 * inertia it is an angular acceleration, so a heavy wheel spins up slowly and a
 * light one recovers fast — the tradeoff a real shooter is designed around.
 *
 * ── Exit speed is derived, not configured ──────────────────────────────────
 *
 * A ball squeezed between a surface moving at `v1` and one moving at `v2` leaves
 * with its centre at the mean of the two, because the contact points must match
 * the surfaces and the centre is midway between them. For the common FTC
 * shooter — one flywheel against a fixed hood — that is half the wheel's surface
 * speed. Two counter-rotating wheels give the whole of it.
 *
 * `transferRatio` names which build it is: exit speed over surface speed. 0.5 is
 * a hooded single wheel, 1.0 is a dual. It is a geometric fact about the design
 * rather than an efficiency fudge, and everything else here follows from it.
 *
 * ── Recovery is conservation of energy ─────────────────────────────────────
 *
 * A shot leaves carrying kinetic energy, and that energy comes out of the
 * wheel: `½Jw² -> ½Jw² - E`. So the wheel slows by an amount that depends on how
 * fast the shot was and how much inertia the wheel has, and the motor has to put
 * it back before the next shot leaves at the same speed. That is the whole fire
 * rate model — there is no cooldown constant anywhere.
 *
 * ASSUMPTIONS.md §9.5.
 */

import { clampDuty, motorCurrent, motorTorque, createMotorModel, type MotorModel } from '../motor/motorModel.js';
import { getMotorDatasheet } from '../motor/catalog/goBILDA.js';
import { feetPerSecToMetersPerSec, inchesToMeters, poundsToKilograms } from '../units/convert.js';
import { amps, radPerSec, volts, type Amps, type RadPerSec, type Volts } from '../units/si.js';
import type { LaunchCapability } from './capability.js';
import type { DerivedMechanism } from './mechanism.js';

/**
 * A flywheel as the physics sees it: an inertia, a radius and a drive.
 *
 * Derived from a `LaunchCapability` and the mechanism's actuation by
 * `deriveFlywheel` below, so nothing in the simulation constructs one by hand.
 */
export interface FlywheelSpec {
  /** `null` for a launch capability with no actuator behind it. */
  readonly motor: MotorModel | null;
  readonly motorCount: number;
  /** Reduction between motor output shaft and wheel. >1 is a reduction. */
  readonly gearRatio: number;
  /** Transmission efficiency, 0-1. */
  readonly efficiency: number;
  /** Rotational inertia of everything spinning, kg·m². */
  readonly inertiaKgM2: number;
  readonly radiusM: number;
  /** Exit speed over surface speed: 0.5 hooded, 1.0 dual. */
  readonly transferRatio: number;
  /** Wheel speed the controller drives toward, rad/s. */
  readonly targetRadPerSec: number;
}

export interface FlywheelState {
  /** Wheel speed, rad/s. Never negative: a shooter spins one way. */
  readonly radPerSec: number;
  /** Whether the driver is asking for spin. */
  readonly running: boolean;
}

export const IDLE_FLYWHEEL: FlywheelState = Object.freeze({ radPerSec: 0, running: false });

export interface FlywheelStep {
  readonly state: FlywheelState;
  /** Current drawn by the shooter this tick, A. Signed like the drivetrain's. */
  readonly currentA: Amps;
  readonly duty: number;
}

/**
 * Duty the controller commands this tick.
 *
 * Full power until the wheel reaches its target, then exactly the duty whose
 * back-EMF balances the target speed — `duty = w_target * kE / V`. That holding
 * value is the steady state of the motor equation rather than a tuned gain, so
 * the controller introduces no constant of its own. It is also what an FTC
 * velocity loop converges to, which is the behaviour being modelled.
 *
 * A target above the motor's free speed at the present battery voltage simply
 * saturates at full duty and never arrives, which is the honest answer: that
 * shooter cannot reach that speed, and the builder should see it.
 */
export function flywheelDuty(spec: FlywheelSpec, state: FlywheelState, batteryVolts: Volts): number {
  if (!state.running || spec.motor === null) return 0;

  const motorRadPerSec = state.radPerSec * spec.gearRatio;
  if (motorRadPerSec < spec.targetRadPerSec * spec.gearRatio) return 1;

  const holding = (spec.targetRadPerSec * spec.gearRatio * spec.motor.kE) / batteryVolts;
  return clampDuty(holding);
}

/**
 * Advance the wheel one tick.
 *
 * Semi-implicit, matching the body integrator: the new speed is computed from
 * the torque at the old speed.
 *
 * `running: false` commands zero duty, which in this motor model means shorted
 * leads — so the wheel spins *down* under back-EMF braking rather than coasting.
 * That is the same behaviour the drivetrain gets for free when a driver releases
 * the sticks (ASSUMPTIONS.md §2.4), and it is why no bearing-drag coefficient is
 * needed anywhere: the only resistance in the model is one the motor really
 * produces.
 */
export function stepFlywheel(
  spec: FlywheelSpec,
  state: FlywheelState,
  dtSec: number,
  batteryVolts: Volts,
): FlywheelStep {
  const duty = flywheelDuty(spec, state, batteryVolts);
  if (spec.motor === null || spec.motorCount === 0) {
    return { state, currentA: amps(0), duty: 0 };
  }

  const motorRadPerSec = radPerSec(state.radPerSec * spec.gearRatio);

  const shaftTorque = motorTorque(spec.motor, motorRadPerSec, duty, batteryVolts);
  const wheelTorque = shaftTorque * spec.gearRatio * spec.efficiency * spec.motorCount;
  const next = state.radPerSec + (wheelTorque / spec.inertiaKgM2) * dtSec;

  return {
    // Braking stops the wheel; it never drives itself backwards.
    state: { radPerSec: Math.max(0, next), running: state.running },
    currentA: amps(motorCurrent(spec.motor, motorRadPerSec, duty, batteryVolts) * spec.motorCount),
    duty,
  };
}

/** Speed a ball leaves at, from the wheel's present speed. */
export function exitSpeedMps(spec: FlywheelSpec, state: FlywheelState): number {
  return state.radPerSec * spec.radiusM * spec.transferRatio;
}

/** Wheel speed needed for a given exit speed. The inverse of `exitSpeedMps`. */
export function requiredRadPerSec(
  exitMps: number,
  radiusM: number,
  transferRatio: number,
): number {
  return exitMps / (radiusM * transferRatio);
}

/**
 * Kinetic energy a launched ball carries away, joules.
 *
 * Translation plus the backspin the transfer imparts. With surfaces at `v1` and
 * `v2` the centre leaves at `(v1 + v2)/2` and the ball spins at
 * `(v1 - v2)/(2r)`; writing both in terms of the transfer ratio `t = v/v1` and
 * using a solid sphere's `I = ⅖mr²` gives
 *
 *     E = ½mv² + ⅕mv²(1-t)²/t²
 *
 * which is `0.7mv²` for a hooded wheel and `0.5mv²` for a dual. The ball's own
 * radius cancels, so this needs no ball geometry at all.
 */
export function shotEnergyJ(massKg: number, exitMps: number, transferRatio: number): number {
  const spin = (1 - transferRatio) / transferRatio;
  return massKg * exitMps * exitMps * (0.5 + 0.2 * spin * spin);
}

/**
 * The wheel after a shot has taken its energy.
 *
 * `½Jw'² = ½Jw² - E`, floored at zero: a wheel with less stored energy than the
 * shot needs cannot fire that shot, which the caller prevents by deriving the
 * shot from the *present* speed rather than from the target.
 */
export function afterShot(
  spec: FlywheelSpec,
  state: FlywheelState,
  energyJ: number,
): FlywheelState {
  const stored = 0.5 * spec.inertiaKgM2 * state.radPerSec * state.radPerSec;
  const remaining = Math.max(0, stored - energyJ);
  return {
    radPerSec: Math.sqrt((2 * remaining) / spec.inertiaKgM2),
    running: state.running,
  };
}

/**
 * How ready the wheel is, 0-1: present speed over target.
 *
 * A display quantity, and deliberately not a gate. Nothing refuses to fire below
 * a threshold — a shot taken at half speed simply goes half as fast and falls
 * short, which is the behaviour a driver has to learn rather than one the
 * simulator should forbid.
 */
export function spinFraction(spec: FlywheelSpec, state: FlywheelState): number {
  if (spec.targetRadPerSec <= 0) return 1;
  return Math.min(1, state.radPerSec / spec.targetRadPerSec);
}

/** Voltage-free convenience for callers holding a plain number. */
export function asBatteryVolts(value: number): Volts {
  return volts(value);
}

/** Speed at the wheel's rim, m/s. What the ball is pressed against. */
export function surfaceSpeedMps(spec: FlywheelSpec, state: FlywheelState): number {
  return state.radPerSec * spec.radiusM;
}

/** Wheel speed the motor freewheels at under a given voltage, rad/s. */
export function freeWheelSpeed(spec: FlywheelSpec, batteryVolts: Volts): RadPerSec {
  if (spec.motor === null) return radPerSec(0);
  return radPerSec(batteryVolts / spec.motor.kE / spec.gearRatio);
}

/**
 * Build a flywheel spec from a mechanism the user configured.
 *
 * A passive mechanism — one with no actuator — still produces a spec, with a
 * null motor. It never spins, which is the right answer for a launch capability
 * declared with nothing to drive it: the geometry is still meaningful, so the
 * builder can see the exit speed it would reach if a motor were fitted.
 */
export function deriveFlywheel(
  mechanism: DerivedMechanism,
  capability: LaunchCapability,
): FlywheelSpec {
  const actuation = mechanism.config.actuation;
  const motor =
    actuation === undefined ? null : createMotorModel(getMotorDatasheet(actuation.motorId));

  const radiusM = inchesToMeters(capability.flywheelDiameterIn) / 2;
  // Solid disc about its axis: I = ½mr². Every FTC flywheel is closer to a disc
  // than to a ring, and the alternative asks the user for a second geometry
  // number they have no way to measure.
  const inertiaKgM2 = 0.5 * poundsToKilograms(capability.flywheelMassLb) * radiusM * radiusM;

  return {
    motor,
    motorCount: actuation?.motorCount ?? 0,
    gearRatio: actuation?.gearRatio ?? 1,
    efficiency: actuation?.efficiency ?? 1,
    inertiaKgM2,
    radiusM,
    transferRatio: capability.transferRatio,
    targetRadPerSec: requiredRadPerSec(
      feetPerSecToMetersPerSec(capability.exitSpeedFtPerSec),
      radiusM,
      capability.transferRatio,
    ),
  };
}

/** The first launch capability a robot carries, with the mechanism it is on. */
export function launcherOf(
  mechanisms: readonly DerivedMechanism[],
): { readonly mechanism: DerivedMechanism; readonly capability: LaunchCapability } | undefined {
  for (const mechanism of mechanisms) {
    for (const capability of mechanism.config.capabilities) {
      if (capability.kind === 'launch') return { mechanism, capability };
    }
  }
  return undefined;
}
