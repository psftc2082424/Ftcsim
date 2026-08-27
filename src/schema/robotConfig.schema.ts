/**
 * Runtime validation for `RobotConfig`.
 *
 * `core/` holds plain TypeScript types; this layer is where untrusted data —
 * an imported preset file, an IndexedDB record written by an older build, and in
 * Phase 4 an LLM-generated document — is checked before it can reach the
 * physics (ARCHITECTURE.md §3.1).
 *
 * ── Two kinds of constraint, deliberately separated ────────────────────────
 *
 *   **Physical sanity** is enforced here and is non-negotiable: a robot cannot
 *   have negative mass or a zero-diameter wheel, because the physics would
 *   produce NaN or divide by zero. Violations are hard errors.
 *
 *   **Competition legality** (the 18 in starting cube, weight caps) is *not*
 *   enforced here. Those limits are season-specific and belong to
 *   `GameDefinition.robotConstraints` in Phase 3. Baking this year's rules into
 *   the schema is precisely the hard-coding PRODUCT_SPEC.md §23 forbids. They
 *   are surfaced as advisory warnings instead, so a user can deliberately
 *   explore an illegal design and still be told it is illegal.
 */

import { z } from 'zod';
import { ROBOT_CONFIG_SCHEMA_VERSION, type RobotConfig } from '../core/robot/robotConfig.js';
import { listMotorIds } from '../core/motor/catalog/goBILDA.js';

/**
 * Outer bounds on physical parameters.
 *
 * These are not competition rules — they are the range outside which a number is
 * far likelier to be a typo or a unit mix-up than a real design intent. A "robot"
 * 500 in long is someone who entered millimetres.
 */
export const PHYSICAL_LIMITS = {
  lengthIn: { min: 1, max: 60 },
  widthIn: { min: 1, max: 60 },
  heightIn: { min: 1, max: 120 },
  massLb: { min: 0.5, max: 200 },
  gearRatio: { min: 0.05, max: 100 },
  wheelDiameterIn: { min: 0.5, max: 24 },
  motorCount: { min: 4, max: 16 },
} as const;

const MECANUM_WHEEL_COUNT = 4;

const boundedNumber = (
  label: string,
  bounds: { readonly min: number; readonly max: number },
): z.ZodNumber =>
  z
    .number({ invalid_type_error: `${label} must be a number.` })
    .finite(`${label} must be finite.`)
    .min(bounds.min, `${label} must be at least ${bounds.min}.`)
    .max(bounds.max, `${label} must be at most ${bounds.max}.`);

export const chassisConfigSchema = z.object({
  lengthIn: boundedNumber('Length', PHYSICAL_LIMITS.lengthIn),
  widthIn: boundedNumber('Width', PHYSICAL_LIMITS.widthIn),
  heightIn: boundedNumber('Height', PHYSICAL_LIMITS.heightIn),
  massLb: boundedNumber('Mass', PHYSICAL_LIMITS.massLb),
});

export const drivetrainConfigSchema = z.object({
  motorId: z.string().min(1, 'A motor must be selected.'),
  motorCount: boundedNumber('Motor count', PHYSICAL_LIMITS.motorCount)
    .int('Motor count must be a whole number.')
    .refine(
      (value) => value % MECANUM_WHEEL_COUNT === 0,
      `A mecanum drivetrain has ${MECANUM_WHEEL_COUNT} wheels, so motor count must be a multiple of ${MECANUM_WHEEL_COUNT}.`,
    ),
  gearRatio: boundedNumber('Gear ratio', PHYSICAL_LIMITS.gearRatio),
  wheelDiameterIn: boundedNumber('Wheel diameter', PHYSICAL_LIMITS.wheelDiameterIn),
});

// -------------------------------------------------------------- mechanisms ---

const pieceTypesSchema = z.array(z.string().min(1)).default([]);

/**
 * One schema per capability, discriminated on `kind`.
 *
 * A discriminated union rather than a loose bag: an `elevate` with a `spreadDeg`
 * is a mistake, and catching it here is what stops a malformed capability from
 * reaching a rules engine that will branch on its shape in Phase 3.
 */
const capabilitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('acquire'),
    pieceTypes: pieceTypesSchema,
    capacity: z.number().int().min(0).max(500),
    reachIn: z.number().finite().min(0).max(60),
    mouthWidthIn: z.number().finite().min(0).max(60),
    acquisitionRatePerSec: z.number().finite().min(0).max(50),
  }),
  z.object({
    kind: z.literal('release'),
    pieceTypes: pieceTypesSchema,
    reachIn: z.number().finite().min(0).max(60),
  }),
  z.object({
    kind: z.literal('launch'),
    pieceTypes: pieceTypesSchema,
    shotsPerSecond: z.number().finite().min(0).max(50),
  }),
  z.object({
    kind: z.literal('elevate'),
    minHeightIn: z.number().finite().min(0).max(200),
    maxHeightIn: z.number().finite().min(0).max(200),
    travelTimeSec: z.number().finite().min(0).max(120),
  }),
  z.object({
    kind: z.literal('climb'),
    level: z.number().int().min(0).max(10),
    timeSec: z.number().finite().min(0).max(120),
    successRate: z.number().finite().min(0).max(1),
  }),
  z.object({
    kind: z.literal('traverse'),
    requiredClearanceIn: z.number().finite().min(0).max(200),
  }),
]);

const mechanismActuationSchema = z.object({
  motorId: z.string().min(1),
  motorCount: z.number().int().min(1).max(8),
  gearRatio: boundedNumber('Mechanism gear ratio', PHYSICAL_LIMITS.gearRatio),
  efficiency: z.number().finite().min(0.01).max(1),
});

export const mechanismConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  /** UI label only — never branched on by the engine (ARCHITECTURE.md §7). */
  preset: z.string().min(1).max(40),
  massLb: z.number().finite().min(0).max(100),
  mount: z.object({
    xIn: z.number().finite().min(-60).max(60),
    yIn: z.number().finite().min(-60).max(60),
    facingDeg: z.number().finite().min(-360).max(360),
  }),
  actuation: mechanismActuationSchema.optional(),
  capabilities: z.array(capabilitySchema).min(1, 'A mechanism must do something.'),
});

export const robotConfigSchema = z.object({
  /**
   * Must already be current. Validation is the step *after* migration, so a
   * stale version here means a caller skipped `migrateRobotConfig()` — a
   * pipeline bug worth a loud, specific message rather than a silent pass.
   */
  schemaVersion: z
    .number()
    .int()
    .positive()
    .refine(
      (value) => value === ROBOT_CONFIG_SCHEMA_VERSION,
      `Expected schema version ${ROBOT_CONFIG_SCHEMA_VERSION}. Run migrateRobotConfig() before validating.`,
    ),
  id: z.string().min(1),
  name: z.string().min(1, 'Name cannot be empty.').max(80, 'Name is too long.'),
  chassis: chassisConfigSchema,
  drivetrain: drivetrainConfigSchema,
  mechanisms: z.array(mechanismConfigSchema),
});

export type RobotConfigShape = z.infer<typeof robotConfigSchema>;

/**
 * Motor ids are checked separately from the shape.
 *
 * The catalogue is data that grows, so an unknown id means "this preset came
 * from a build with a motor we do not have" — a distinct, actionable problem
 * from a malformed record, and worth its own message.
 */
function checkMotorId(config: RobotConfigShape): string | null {
  const known = listMotorIds();
  if (known.includes(config.drivetrain.motorId)) return null;
  return `Unknown motor "${config.drivetrain.motorId}". Known motors: ${known.join(', ')}.`;
}

export interface ValidationFailure {
  readonly path: string;
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly config: RobotConfig }
  | { readonly ok: false; readonly errors: readonly ValidationFailure[] };

/** Validate untrusted data into a `RobotConfig`. Never throws. */
export function safeParseRobotConfig(raw: unknown): ParseResult {
  const parsed = robotConfigSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  const motorError = checkMotorId(parsed.data);
  if (motorError !== null) {
    return { ok: false, errors: [{ path: 'drivetrain.motorId', message: motorError }] };
  }

  return { ok: true, config: parsed.data satisfies RobotConfig };
}

/** Validate, throwing on failure. For code paths where invalid data is a bug. */
export function parseRobotConfig(raw: unknown): RobotConfig {
  const result = safeParseRobotConfig(raw);
  if (result.ok) return result.config;

  const detail = result.errors.map((e) => (e.path === '' ? e.message : `${e.path}: ${e.message}`));
  throw new Error(`Invalid robot configuration:\n  ${detail.join('\n  ')}`);
}

// --------------------------------------------------------------- advisory ---

export type WarningSeverity = 'legality' | 'plausibility';

export interface ConfigWarning {
  readonly severity: WarningSeverity;
  readonly path: string;
  readonly message: string;
}

/**
 * Season-stable FTC starting-size limit, in inches.
 *
 * A robot must start a match fitting inside an 18 in cube. This has held for
 * many seasons but is still a *rule*, not physics — so it produces a warning,
 * never a validation failure, and Phase 3 will read the real number from the
 * GameDefinition instead.
 */
export const FTC_STARTING_CUBE_IN = 18;

/**
 * Advisory checks. A configuration can be perfectly valid and still worth
 * flagging — an illegal-but-interesting robot is a legitimate thing to explore.
 */
export function warningsFor(config: RobotConfig): readonly ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  const oversize: Array<[string, number]> = [
    ['chassis.lengthIn', config.chassis.lengthIn],
    ['chassis.widthIn', config.chassis.widthIn],
    ['chassis.heightIn', config.chassis.heightIn],
  ];
  for (const [path, value] of oversize) {
    if (value > FTC_STARTING_CUBE_IN) {
      warnings.push({
        severity: 'legality',
        path,
        message: `Exceeds the ${FTC_STARTING_CUBE_IN} in FTC starting-size limit (${value} in).`,
      });
    }
  }

  // Below this the wheel-inset derivation clamps and the geometry stops being
  // meaningful (ASSUMPTIONS.md §1.2).
  const smallest = Math.min(config.chassis.lengthIn, config.chassis.widthIn);
  if (smallest < 4) {
    warnings.push({
      severity: 'plausibility',
      path: 'chassis',
      message: `A ${smallest} in chassis is smaller than its own wheel inset; derived track and wheelbase will be clamped.`,
    });
  }

  if (config.chassis.massLb < 5) {
    warnings.push({
      severity: 'plausibility',
      path: 'chassis.massLb',
      message: `${config.chassis.massLb} lb is far below a realistic FTC robot; acceleration figures will be extreme.`,
    });
  }

  return warnings;
}
