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
  readonly mechanisms: MechanismSnapshot;
}

/**
 * What a robot's intake and shooter are doing.
 *
 * Present for every robot; a robot with no such mechanism reports a shooter that
 * is not running and a hopper that is empty, so a consumer never has to ask
 * whether the fields exist.
 */
export interface MechanismSnapshot {
  /** Piece ids in the hopper, oldest first. */
  readonly held: readonly string[];
  readonly capacity: number;
  readonly intake: 'off' | 'intake' | 'outtake';
  readonly hasIntake: boolean;
  readonly hasLauncher: boolean;
  /** Gate between storage and the shooter. */
  readonly gateOpen: boolean;
  readonly shooterRunning: boolean;
  /** A functional shooter is ready as soon as it is enabled. */
  readonly shooterReady: boolean;
}

/**
 * A game piece in the world.
 *
 * Carries both identities on purpose: `id` is the numeric entity id the physics
 * layer keys bodies by, while `pieceId` and `pieceType` are the string
 * identifiers the game layer's events use. Keeping both here is what lets a
 * caller map a snapshot onto region-membership observations without either layer
 * importing the other.
 */
export interface PieceSnapshot {
  readonly id: EntityId;
  readonly pieceId: string;
  readonly pieceType: string;

  readonly pose: Pose;
  /** Pose at the end of the previous tick, for render interpolation. */
  readonly previousPose: Pose;
  readonly vel: Velocity;

  readonly radiusM: number;
  /** Height of the piece's centre above the floor. */
  readonly heightM: number;
  /** Height at the end of the previous tick, for render interpolation. */
  readonly previousHeightM: number;
  /** Rate of change of height. Up is positive. */
  readonly verticalVelocityMps: number;
  /** Off the floor — in flight, or bouncing. */
  readonly airborne: boolean;
  /**
   * Robot carrying this piece, or `null` when it is loose on the field.
   *
   * Authoritative: a carried piece is held by a mechanism rather than merely
   * touching a robot, so nothing downstream has to infer possession from
   * geometry for one that has actually been collected.
   */
  readonly heldByRobotId: EntityId | null;
}

export interface WorldSnapshot {
  readonly tick: number;
  /** Simulated time, derived from the tick counter — never wall clock. */
  readonly timeSec: number;
  readonly robots: readonly RobotSnapshot[];
  readonly pieces: readonly PieceSnapshot[];
  readonly batteryVolts: number;
  readonly batteryCurrentA: number;
}
