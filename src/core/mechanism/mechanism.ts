/**
 * Mechanism configuration and derivation.
 *
 * A mechanism is mass, a mounting position, an optional actuator, and a set of
 * capabilities. The `preset` field is a UI label only — searching `core/` for a
 * branch on it should return nothing, and a test asserts the engine's behaviour
 * does not depend on it.
 *
 * ── Where the tradeoffs come from ──────────────────────────────────────────
 *
 * Mechanisms carry mass and consume motor ports. Total robot mass is chassis
 * plus mechanisms, so a higher-capacity intake really does cost acceleration,
 * and a climber really does compete with a shooter for the Control Hub's eight
 * motor ports. PRODUCT_SPEC.md §11 asks for real engineering tradeoffs; these
 * are the mechanism by which they exist rather than being hand-tuned.
 */

import { rpmToRadPerSec } from '../units/convert.js';
import { createMotorModel } from '../motor/motorModel.js';
import { getMotorDatasheet } from '../motor/catalog/goBILDA.js';
import type { Capability } from './capability.js';

/**
 * Motor ports available on a competition-legal FTC control system: four on the
 * Control Hub and four on an Expansion Hub. Season-stable, and the reason a
 * robot cannot have every mechanism at once.
 */
export const TOTAL_MOTOR_PORTS = 8;

export interface MechanismMount {
  /** Offset from the robot centre in the body frame, inches. +x forward, +y left. */
  readonly xIn: number;
  readonly yIn: number;
  /** Facing relative to robot-forward, degrees counter-clockwise. */
  readonly facingDeg: number;
}

export interface MechanismActuation {
  readonly motorId: string;
  readonly motorCount: number;
  /** Reduction between motor output shaft and the mechanism. */
  readonly gearRatio: number;
  /** Transmission efficiency, 0-1. */
  readonly efficiency: number;
}

export interface MechanismConfig {
  readonly id: string;
  readonly name: string;
  /**
   * Authoring label — 'intake', 'shooter', 'climber'. Purely cosmetic: no engine
   * code may branch on this value.
   */
  readonly preset: string;
  readonly massLb: number;
  readonly mount: MechanismMount;
  /**
   * Absent for a passive mechanism — a fixed hook, a deflector, a dead-axle
   * roller. Declared optional-or-undefined because a validated record may carry
   * the key explicitly set to undefined, which `exactOptionalPropertyTypes`
   * treats as a distinct type from an omitted key.
   */
  readonly actuation?: MechanismActuation | undefined;
  readonly capabilities: readonly Capability[];
}

export interface DerivedMechanism {
  readonly config: MechanismConfig;
  readonly massLb: number;
  readonly motorCount: number;
  /**
   * Output speed of the mechanism, RPM. `null` when the mechanism has no
   * actuator (a passive deflector, a fixed hook).
   */
  readonly outputRpm: number | null;
  /**
   * Throughput in pieces per second for rate-driven capabilities.
   *
   * Derived rather than typed in: one piece is handled per revolution of the
   * mechanism's output, which is the standard first-order model for a roller
   * intake or an indexed feeder. PRODUCT_SPEC.md §14 requires stats to
   * correspond to actual mechanism parameters.
   */
  readonly throughputPerSec: number | null;
  /** Torque available at the mechanism output, N·m. `null` when passive. */
  readonly outputTorqueNm: number | null;
}

/** Pieces handled per revolution of the mechanism output. ASSUMPTIONS.md §9.1. */
export const PIECES_PER_OUTPUT_REVOLUTION = 1;

export function deriveMechanism(config: MechanismConfig): DerivedMechanism {
  if (!Number.isFinite(config.massLb) || config.massLb < 0) {
    throw new Error(`Mechanism "${config.id}" mass must be a non-negative number.`);
  }

  const actuation = config.actuation;
  if (actuation === undefined) {
    return {
      config,
      massLb: config.massLb,
      motorCount: 0,
      outputRpm: null,
      throughputPerSec: null,
      outputTorqueNm: null,
    };
  }

  if (!Number.isFinite(actuation.gearRatio) || actuation.gearRatio <= 0) {
    throw new Error(`Mechanism "${config.id}" gear ratio must be positive.`);
  }
  if (!Number.isInteger(actuation.motorCount) || actuation.motorCount <= 0) {
    throw new Error(`Mechanism "${config.id}" motor count must be a positive integer.`);
  }

  const motor = createMotorModel(getMotorDatasheet(actuation.motorId));

  const outputRpm = motor.datasheet.freeSpeedRpm / actuation.gearRatio;
  const outputTorqueNm =
    motor.stallTorque * actuation.gearRatio * actuation.efficiency * actuation.motorCount;

  return {
    config,
    massLb: config.massLb,
    motorCount: actuation.motorCount,
    outputRpm,
    throughputPerSec: (rpmToRadPerSec(outputRpm) / (Math.PI * 2)) * PIECES_PER_OUTPUT_REVOLUTION,
    outputTorqueNm,
  };
}

export interface MechanismTotals {
  readonly massLb: number;
  readonly motorCount: number;
  readonly derived: readonly DerivedMechanism[];
}

export function deriveMechanisms(
  configs: readonly MechanismConfig[] = [],
): MechanismTotals {
  const derived = configs.map(deriveMechanism);
  return {
    massLb: derived.reduce((sum, m) => sum + m.massLb, 0),
    motorCount: derived.reduce((sum, m) => sum + m.motorCount, 0),
    derived,
  };
}

/**
 * Mass-weighted centre of mass offset from the chassis centroid, in inches.
 *
 * Supersedes the "centre of mass is the geometric centre" assumption once
 * mechanisms exist (ASSUMPTIONS.md §1.4). The chassis is still treated as
 * uniform; each mechanism is a point mass at its mount.
 */
export function centreOfMassOffsetIn(
  chassisMassLb: number,
  mechanisms: readonly DerivedMechanism[],
): { xIn: number; yIn: number } {
  const totalMass = chassisMassLb + mechanisms.reduce((sum, m) => sum + m.massLb, 0);
  if (totalMass <= 0) return { xIn: 0, yIn: 0 };

  let momentX = 0;
  let momentY = 0;
  for (const mechanism of mechanisms) {
    momentX += mechanism.massLb * mechanism.config.mount.xIn;
    momentY += mechanism.massLb * mechanism.config.mount.yIn;
  }

  // The chassis contributes zero moment: it is centred on the origin.
  return { xIn: momentX / totalMass, yIn: momentY / totalMass };
}

export interface PortBudget {
  readonly used: number;
  readonly available: number;
  readonly remaining: number;
  readonly overBudget: boolean;
}

/**
 * Motor-port accounting. The drivetrain takes its share first; whatever is left
 * is what mechanisms can compete for. This is the constraint that makes a robot
 * unable to be good at everything.
 */
export function portBudget(driveMotorCount: number, mechanismMotorCount: number): PortBudget {
  const used = driveMotorCount + mechanismMotorCount;
  return {
    used,
    available: TOTAL_MOTOR_PORTS,
    remaining: TOTAL_MOTOR_PORTS - used,
    overBudget: used > TOTAL_MOTOR_PORTS,
  };
}
