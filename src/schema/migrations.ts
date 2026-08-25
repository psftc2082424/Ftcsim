/**
 * Schema migrations for persisted robot configurations.
 *
 * This tool is meant to span FTC seasons, and a user's saved robots have to
 * survive that. Retrofitting migrations after records exist in the wild is
 * miserable, so the ladder is built before the first record is ever written
 * (ARCHITECTURE.md §4.2).
 *
 * Each migration takes a record at version *N* and returns it at version
 * *N + 1*. They are applied in order until the record reaches the current
 * version, so a v1 record loaded three seasons later walks the whole ladder.
 *
 * Rules for adding one:
 *
 *   - Never edit an existing migration. It has already run against real data.
 *   - Never skip a version. The ladder must have no gaps.
 *   - A migration receives a plain object and must return a plain object; it
 *     runs *before* validation, so it cannot assume the record is well-formed
 *     beyond the shape the previous version guaranteed.
 */

import { ROBOT_CONFIG_SCHEMA_VERSION } from '../core/robot/robotConfig.js';

export const CURRENT_ROBOT_CONFIG_VERSION = ROBOT_CONFIG_SCHEMA_VERSION;

export type MigrationStep = (record: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version being migrated *from*. */
const MIGRATIONS = new Map<number, MigrationStep>([
  [
    /**
     * v1 -> v2: the capability framework added `mechanisms`.
     *
     * A v1 robot had no mechanisms at all, so the correct upgrade is an empty
     * array — not a guess at what the user might have wanted. Chassis mass keeps
     * its v1 meaning, because it always described the chassis alone; what
     * changed is that total mass is now derived as chassis + mechanisms.
     */
    1,
    (record) => ({ ...record, schemaVersion: 2, mechanisms: [] }),
  ],
]);

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly fromVersion: number,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVersion(record: Record<string, unknown>): number {
  const raw = record['schemaVersion'];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new MigrationError(
      `Record has no usable schemaVersion (got ${JSON.stringify(raw)}).`,
      Number.NaN,
    );
  }
  return raw;
}

/**
 * Walk a stored record up to the current schema version.
 *
 * Returns the migrated record without validating it — validation is a separate
 * step, so a migration bug surfaces as a validation failure with a real message
 * rather than as a silently reshaped record.
 */
export function migrateRobotConfig(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) {
    throw new MigrationError('Stored robot configuration is not an object.', Number.NaN);
  }

  let record = { ...raw };
  let version = readVersion(record);

  if (version > CURRENT_ROBOT_CONFIG_VERSION) {
    throw new MigrationError(
      `Record is version ${version}, newer than this build understands ` +
        `(${CURRENT_ROBOT_CONFIG_VERSION}). It was probably written by a newer version of the app.`,
      version,
    );
  }

  const seen = new Set<number>();
  while (version < CURRENT_ROBOT_CONFIG_VERSION) {
    if (seen.has(version)) {
      throw new MigrationError(`Migration loop detected at version ${version}.`, version);
    }
    seen.add(version);

    const step = MIGRATIONS.get(version);
    if (step === undefined) {
      throw new MigrationError(
        `No migration registered from version ${version} to ${version + 1}.`,
        version,
      );
    }

    record = step(record);
    const next = readVersion(record);
    if (next !== version + 1) {
      throw new MigrationError(
        `Migration from version ${version} produced version ${next}, expected ${version + 1}.`,
        version,
      );
    }
    version = next;
  }

  return record;
}

/** Registered migration source versions, for tests and diagnostics. */
export function registeredMigrationVersions(): readonly number[] {
  return [...MIGRATIONS.keys()].sort((a, b) => a - b);
}
