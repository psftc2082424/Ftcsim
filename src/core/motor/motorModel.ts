/**
 * DC motor model, in the k_t / k_e / R form (ARCHITECTURE.md §5.1).
 *
 * Constants are derived once per catalogue entry from the two points every
 * datasheet publishes — free speed and stall torque:
 *
 *     k_e = V_nom / omega_free
 *     R   = V_nom / I_stall
 *     k_t = tau_stall / I_stall
 *
 * and the per-tick behaviour is
 *
 *     tau(omega, duty, V) = k_t * (duty * V - k_e * omega) / R
 *     I(omega, duty, V)   =       (duty * V - k_e * omega) / R
 *
 * Why this form rather than the more familiar `tau = tau_stall (1 - w/w_free)`:
 *
 *   - Duty cycle and battery voltage enter correctly, as a scaling of the
 *     applied terminal voltage, instead of being bolted on afterwards.
 *   - Torque goes *negative* once `omega` exceeds the effective free speed for
 *     the applied voltage. That is the physical description of a motor acting
 *     as a shorted generator, and it gives brake-mode deceleration for free —
 *     no invented drag coefficient is needed anywhere in the drivetrain
 *     (ASSUMPTIONS.md §2.4).
 *   - It reproduces both published endpoints exactly, so the model is
 *     calibrated to the datasheet rather than merely inspired by it.
 *
 * Speeds and torques here are at the motor's **output shaft**, matching how
 * goBILDA publishes them. Gearbox reduction and gearbox losses are already
 * inside the catalogue numbers; external belt reduction is applied later, in
 * the drivetrain (ASSUMPTIONS.md §2.3).
 */

import { rpmToRadPerSec, kgCmToNewtonMeters } from '../units/convert.js';
import {
  amps,
  newtonMeters,
  newtonMetersPerAmp,
  ohms,
  radPerSec,
  voltSecPerRad,
  type Amps,
  type NewtonMeters,
  type NewtonMetersPerAmp,
  type Ohms,
  type RadPerSec,
  type VoltSecPerRad,
  type Volts,
} from '../units/si.js';
import type { MotorDatasheet } from './catalog/goBILDA.js';

export interface MotorModel {
  readonly datasheet: MotorDatasheet;

  /** No-load speed at the output shaft, at nominal voltage. */
  readonly freeSpeed: RadPerSec;
  /** Stall torque at the output shaft, at nominal voltage. */
  readonly stallTorque: NewtonMeters;

  /** Back-EMF constant, V per rad/s. */
  readonly kE: VoltSecPerRad;
  /** Effective torque constant at the output shaft, N·m per A. */
  readonly kT: NewtonMetersPerAmp;
  /** Effective winding resistance, ohms. */
  readonly resistance: Ohms;
}

export function createMotorModel(datasheet: MotorDatasheet): MotorModel {
  const freeSpeed = rpmToRadPerSec(datasheet.freeSpeedRpm);
  const stallTorque = newtonMeters(kgCmToNewtonMeters(datasheet.stallTorqueKgCm));

  if (freeSpeed <= 0) {
    throw new Error(`Motor "${datasheet.id}" has non-positive free speed.`);
  }
  if (datasheet.stallCurrentA <= 0) {
    throw new Error(`Motor "${datasheet.id}" has non-positive stall current.`);
  }

  return {
    datasheet,
    freeSpeed,
    stallTorque,
    kE: voltSecPerRad(datasheet.nominalVoltageV / freeSpeed),
    kT: newtonMetersPerAmp(stallTorque / datasheet.stallCurrentA),
    resistance: ohms(datasheet.nominalVoltageV / datasheet.stallCurrentA),
  };
}

/** Clamp a commanded duty cycle into [-1, 1]. Sign selects direction. */
export function clampDuty(duty: number): number {
  if (Number.isNaN(duty)) return 0;
  return duty < -1 ? -1 : duty > 1 ? 1 : duty;
}

/**
 * Net current through the winding.
 *
 * Negative while the motor is being back-driven above its effective free speed,
 * which is the regenerative/braking regime.
 */
export function motorCurrent(
  motor: MotorModel,
  omega: RadPerSec,
  duty: number,
  batteryVolts: Volts,
): Amps {
  const terminalVolts = clampDuty(duty) * batteryVolts;
  return amps((terminalVolts - motor.kE * omega) / motor.resistance);
}

/** Shaft torque at the output shaft. Same sign convention as `motorCurrent`. */
export function motorTorque(
  motor: MotorModel,
  omega: RadPerSec,
  duty: number,
  batteryVolts: Volts,
): NewtonMeters {
  return newtonMeters(motor.kT * motorCurrent(motor, omega, duty, batteryVolts));
}

/**
 * Speed at which the motor produces zero torque for a given command — the point
 * where back-EMF balances the applied terminal voltage.
 *
 * Used by the analytic reference tests: with an ideal drivetrain and no external
 * resistance, this is exactly where a robot's speed settles.
 */
export function effectiveFreeSpeed(
  motor: MotorModel,
  duty: number,
  batteryVolts: Volts,
): RadPerSec {
  return radPerSec((clampDuty(duty) * batteryVolts) / motor.kE);
}
