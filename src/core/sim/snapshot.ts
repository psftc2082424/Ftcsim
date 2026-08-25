/**
 * Immutable read-model of the simulation.
 *
 * A snapshot is the *only* thing renderers, telemetry and controllers ever see.
 * They cannot reach into `SimWorld` and cannot mutate anything, which is what
 * enforces "rendering is a pure read of simulation state" (CLAUDE.md) as a type
 * property rather than a convention.
 *
 * Each robot carries both its current and its previous pose so the renderer can
 * interpolate between ticks without knowing anything about the sim clock. That
 * is what decouples frame rate from tick rate: the physics always advances in
 * whole 5 ms steps, and the renderer draws somewhere between the last two.
 */

import type { EntityId, Pose, Velocity } from '../physics/body.js';
import type { ChassisVelocity, WheelValues } from '../drive/mecanumKinematics.js';

export type Alliance = 'red' | 'blue';

export interface DriveSnapshot {
  /** Saturated per-wheel duty cycles. */
  readonly duties: WheelValues;
  /** Motor output-shaft speeds, rad/s. */
  readonly motorSpeeds: WheelValues;
  /** Motor output-shaft torques, N·m. */
  readonly motorTorques: WheelValues;
  /** Signed per-motor current, A. */
  readonly motorCurrents: WheelValues;
  /** Contact-patch forces, N. */
  readonly wheelForces: WheelValues;
}

export interface RobotSnapshot {
  readonly id: EntityId;
  readonly name: string;
  readonly alliance: Alliance;

  readonly pose: Pose;
  /** Pose at the end of the previous tick, for render interpolation. */
  readonly previousPose: Pose;
  readonly vel: Velocity;

  /** Body-frame velocity: forward, left, counter-clockwise. */
  readonly chassis: ChassisVelocity;
  /** World-frame linear acceleration over the last tick, m/s². */
  readonly accelerationMps2: number;

  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM: number;

  /** External reduction, motor output shaft to wheel. */
  readonly gearRatio: number;
  readonly wheelRadiusM: number;

  readonly drive: DriveSnapshot;
}

export interface WorldSnapshot {
  readonly tick: number;
  /** Simulated time, derived from the tick counter — never wall clock. */
  readonly timeSec: number;
  readonly robots: readonly RobotSnapshot[];
  readonly batteryVolts: number;
  readonly batteryCurrentA: number;
}
