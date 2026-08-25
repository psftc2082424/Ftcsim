/**
 * SI unit system for `core/`.
 *
 * Every physical quantity inside the simulation core is expressed in SI:
 * metres, kilograms, seconds, newtons, newton-metres, radians. FTC-facing units
 * (inches, pounds, ft/s, degrees, RPM) exist only at the UI boundary and are
 * converted in `units/convert.ts`.
 *
 * Quantities are *branded* so that passing inches where metres are expected is a
 * compile error. Branding is deliberately shallow: arithmetic on two branded
 * values yields a plain `number`, and the result is re-branded explicitly at the
 * point where it is stored or returned. That keeps the physics readable while
 * still catching the mistakes that actually happen — unit mix-ups across module
 * boundaries.
 */

declare const UNIT: unique symbol;

type Branded<Tag extends string> = number & { readonly [UNIT]: Tag };

// --- Kinematic -------------------------------------------------------------
export type Meters = Branded<'m'>;
export type MetersPerSec = Branded<'m/s'>;
export type MetersPerSec2 = Branded<'m/s^2'>;
export type Radians = Branded<'rad'>;
export type RadPerSec = Branded<'rad/s'>;
export type RadPerSec2 = Branded<'rad/s^2'>;
export type Seconds = Branded<'s'>;

// --- Inertial --------------------------------------------------------------
export type Kilograms = Branded<'kg'>;
/** Moment of inertia about the vertical axis. */
export type KgMeters2 = Branded<'kg*m^2'>;

// --- Mechanical ------------------------------------------------------------
export type Newtons = Branded<'N'>;
export type NewtonMeters = Branded<'N*m'>;

// --- Electrical ------------------------------------------------------------
export type Volts = Branded<'V'>;
export type Amps = Branded<'A'>;
export type Ohms = Branded<'ohm'>;
/** Motor back-EMF constant, V per rad/s. */
export type VoltSecPerRad = Branded<'V*s/rad'>;
/** Motor torque constant, N·m per amp. */
export type NewtonMetersPerAmp = Branded<'N*m/A'>;

// --- Constructors ----------------------------------------------------------
// These are the only sanctioned way to attach a unit brand to a raw number.

export const meters = (v: number): Meters => v as Meters;
export const metersPerSec = (v: number): MetersPerSec => v as MetersPerSec;
export const metersPerSec2 = (v: number): MetersPerSec2 => v as MetersPerSec2;
export const radians = (v: number): Radians => v as Radians;
export const radPerSec = (v: number): RadPerSec => v as RadPerSec;
export const radPerSec2 = (v: number): RadPerSec2 => v as RadPerSec2;
export const seconds = (v: number): Seconds => v as Seconds;

export const kilograms = (v: number): Kilograms => v as Kilograms;
export const kgMeters2 = (v: number): KgMeters2 => v as KgMeters2;

export const newtons = (v: number): Newtons => v as Newtons;
export const newtonMeters = (v: number): NewtonMeters => v as NewtonMeters;

export const volts = (v: number): Volts => v as Volts;
export const amps = (v: number): Amps => v as Amps;
export const ohms = (v: number): Ohms => v as Ohms;
export const voltSecPerRad = (v: number): VoltSecPerRad => v as VoltSecPerRad;
export const newtonMetersPerAmp = (v: number): NewtonMetersPerAmp => v as NewtonMetersPerAmp;

/**
 * Strip a unit brand. Use only where a branded value must be handed to generic
 * numeric code; prefer keeping the brand as far in as possible.
 */
export const unwrap = (v: number): number => v;
