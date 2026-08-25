/**
 * The FTC ⇄ SI boundary.
 *
 * FTC teams think in inches, pounds, feet per second, degrees and RPM. The
 * simulation core thinks exclusively in SI. Every conversion between the two
 * lives here, so there is exactly one place to audit for unit errors and exactly
 * one place a reviewer has to read to know how a displayed number was produced.
 *
 * Never convert inline at a call site.
 */

import {
  amps,
  kilograms,
  meters,
  metersPerSec,
  metersPerSec2,
  radPerSec,
  radians,
  volts,
  type Amps,
  type Kilograms,
  type Meters,
  type MetersPerSec,
  type MetersPerSec2,
  type RadPerSec,
  type Radians,
  type Volts,
} from './si.js';

// --- Exact definitional constants -----------------------------------------
// These are definitions, not measurements: the international inch, foot and
// avoirdupois pound are each defined exactly in terms of SI.

/** 1 inch ≡ 0.0254 m exactly. */
export const METERS_PER_INCH = 0.0254;
/** 1 foot ≡ 0.3048 m exactly. */
export const METERS_PER_FOOT = 0.3048;
/**
 * 1 avoirdupois pound ≡ 0.45359237 kg exactly.
 *
 * Note this is pound-*mass*. FTC robot weights are quoted as lbm, and mass is
 * what enters F = ma. Pound-force and slugs never appear in this codebase.
 */
export const KILOGRAMS_PER_POUND = 0.45359237;

const TAU = Math.PI * 2;

// --- Length ----------------------------------------------------------------
export const inchesToMeters = (inches: number): Meters => meters(inches * METERS_PER_INCH);
export const metersToInches = (m: Meters): number => m / METERS_PER_INCH;

export const feetToMeters = (feet: number): Meters => meters(feet * METERS_PER_FOOT);
export const metersToFeet = (m: Meters): number => m / METERS_PER_FOOT;

// --- Mass ------------------------------------------------------------------
export const poundsToKilograms = (lb: number): Kilograms => kilograms(lb * KILOGRAMS_PER_POUND);
export const kilogramsToPounds = (kg: Kilograms): number => kg / KILOGRAMS_PER_POUND;

// --- Linear velocity -------------------------------------------------------
export const feetPerSecToMetersPerSec = (fps: number): MetersPerSec =>
  metersPerSec(fps * METERS_PER_FOOT);
export const metersPerSecToFeetPerSec = (mps: MetersPerSec): number => mps / METERS_PER_FOOT;

export const inchesPerSecToMetersPerSec = (ips: number): MetersPerSec =>
  metersPerSec(ips * METERS_PER_INCH);
export const metersPerSecToInchesPerSec = (mps: MetersPerSec): number => mps / METERS_PER_INCH;

// --- Linear acceleration ---------------------------------------------------
export const feetPerSec2ToMetersPerSec2 = (fps2: number): MetersPerSec2 =>
  metersPerSec2(fps2 * METERS_PER_FOOT);
export const metersPerSec2ToFeetPerSec2 = (mps2: MetersPerSec2): number => mps2 / METERS_PER_FOOT;

// --- Angle -----------------------------------------------------------------
export const degreesToRadians = (deg: number): Radians => radians((deg * Math.PI) / 180);
export const radiansToDegrees = (rad: Radians): number => (rad * 180) / Math.PI;

// --- Angular velocity ------------------------------------------------------
export const degPerSecToRadPerSec = (dps: number): RadPerSec => radPerSec((dps * Math.PI) / 180);
export const radPerSecToDegPerSec = (rps: RadPerSec): number => (rps * 180) / Math.PI;

/** Motor and wheel speeds are quoted in RPM on every datasheet. */
export const rpmToRadPerSec = (rpm: number): RadPerSec => radPerSec((rpm * TAU) / 60);
export const radPerSecToRpm = (rps: RadPerSec): number => (rps * 60) / TAU;

// --- Electrical ------------------------------------------------------------
// Present for symmetry: datasheet values are already SI, but routing them
// through this module keeps every branded construction in one place.
export const asVolts = (v: number): Volts => volts(v);
export const asAmps = (a: number): Amps => amps(a);

// --- Torque ----------------------------------------------------------------
/** Standard gravity, exact by definition of the kilogram-force. */
export const STANDARD_GRAVITY = 9.80665;
const METERS_PER_CENTIMETER = 0.01;
const OUNCES_FORCE_PER_POUND_FORCE = 16;

/**
 * goBILDA quotes stall torque in kg·cm on its datasheets.
 * 1 kg·cm is the torque of one kilogram-force acting at one centimetre.
 */
export const KG_CM_TO_NEWTON_METERS = STANDARD_GRAVITY * METERS_PER_CENTIMETER;
export const kgCmToNewtonMeters = (kgcm: number): number => kgcm * KG_CM_TO_NEWTON_METERS;
export const newtonMetersToKgCm = (nm: number): number => nm / KG_CM_TO_NEWTON_METERS;

/**
 * goBILDA prints stall torque in both kg·cm and oz-in on the same datasheet.
 * Converting each independently and checking they agree validates this module
 * against the manufacturer's own arithmetic — see the catalogue cross-check test.
 *
 * Derived from the definitional constants above rather than written as a
 * literal, so there is no rounded magic number to get wrong:
 * 1 oz-in = (1 lb / 16) × g × 1 inch.
 */
export const OZ_IN_TO_NEWTON_METERS =
  ((KILOGRAMS_PER_POUND * STANDARD_GRAVITY) / OUNCES_FORCE_PER_POUND_FORCE) * METERS_PER_INCH;
export const ozInToNewtonMeters = (ozin: number): number => ozin * OZ_IN_TO_NEWTON_METERS;
export const newtonMetersToOzIn = (nm: number): number => nm / OZ_IN_TO_NEWTON_METERS;
