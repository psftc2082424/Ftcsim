/**
 * Serializable robot configuration — the user-authored half of the robot model.
 *
 * PRODUCT_SPEC.md §4 is strict about what a user may configure physically:
 * length, width, height and mass, and nothing else. Centre of mass, moment of
 * inertia, wheelbase, track width and any friction or traction coefficient are
 * absent here by design. Everything the physics needs beyond these four numbers
 * is derived in `robot/derive.ts`.
 *
 * Dimensions are in FTC units because this is what a user types and what a
 * preset stores. Conversion to SI happens exactly once, during derivation.
 *
 * `mechanisms` arrived in schema version 2 with the capability framework. Note
 * what is *not* here: a mechanism's mass is its own, and total robot mass is
 * derived as chassis + mechanisms rather than being a second thing to keep in
 * sync (PRODUCT_SPEC.md §4 and §11).
 */

import { getMechanismPreset, instantiateMechanism } from '../mechanism/presets.js';
import type { MechanismConfig } from '../mechanism/mechanism.js';

export const ROBOT_CONFIG_SCHEMA_VERSION = 2;

export interface ChassisConfig {
  readonly lengthIn: number;
  readonly widthIn: number;
  readonly heightIn: number;
  /** Chassis mass alone. Mechanism mass is added on top during derivation. */
  readonly massLb: number;
}

export interface DrivetrainConfig {
  /** Identifier into the goBILDA catalogue. */
  readonly motorId: string;
  /** Total drive motors. Must be a positive multiple of 4 for a mecanum drive. */
  readonly motorCount: number;
  /** External reduction between motor output shaft and wheel. >1 is a reduction. */
  readonly gearRatio: number;
  readonly wheelDiameterIn: number;
}

export interface RobotConfig {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly chassis: ChassisConfig;
  readonly drivetrain: DrivetrainConfig;
  readonly mechanisms: readonly MechanismConfig[];
}

/**
 * A representative FTC competition robot, used as the default in the UI and as
 * the fixture for the analytic reference tests.
 *
 * 18 × 18 in is the standard FTC starting-size limit; 32 lb is a typical
 * competition weight; 4 × 312 RPM Yellow Jackets on 96 mm mecanum wheels
 * (3.78 in) direct-driven at 1:1 is the most common FTC drivetrain there is.
 */
export const DEFAULT_ROBOT_CONFIG: RobotConfig = Object.freeze({
  schemaVersion: ROBOT_CONFIG_SCHEMA_VERSION,
  id: 'default-mecanum',
  name: 'Default Mecanum',
  chassis: Object.freeze({
    lengthIn: 18,
    widthIn: 18,
    heightIn: 18,
    massLb: 32,
  }),
  drivetrain: Object.freeze({
    motorId: 'gobilda-5203-312',
    motorCount: 4,
    gearRatio: 1,
    wheelDiameterIn: 3.78,
  }),
  mechanisms: Object.freeze([]),
});

/**
 * The default robot with an intake and a shooter bolted on.
 *
 * `DEFAULT_ROBOT_CONFIG` is deliberately a bare drivetrain: it is the fixture
 * the analytic reference tests measure against, and adding mass to it would
 * change every one of those numbers. This is what the application starts with
 * instead — a robot that can actually play, assembled from the same mechanism
 * templates the builder UI offers, so nothing here is a number the user cannot
 * also reach and change.
 *
 * Four drive motors plus one each for the intake and the shooter is six of the
 * eight ports, which leaves the tradeoff visible rather than spent.
 */
export const COMPETITION_ROBOT_CONFIG: RobotConfig = Object.freeze({
  ...DEFAULT_ROBOT_CONFIG,
  id: 'competition-mecanum',
  name: 'Competition Mecanum',
  mechanisms: Object.freeze([
    instantiateMechanism(getMechanismPreset('intake'), 'intake-1'),
    instantiateMechanism(getMechanismPreset('shooter'), 'shooter-1'),
  ]),
});
