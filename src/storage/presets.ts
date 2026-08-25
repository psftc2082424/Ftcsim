/**
 * Robot preset repository (PRODUCT_SPEC.md §9).
 *
 * Create, save, load, edit, duplicate, rename, delete — persisting between
 * sessions, in a structured format that exports and imports.
 *
 * The load path is where the schema layer earns its keep:
 *
 *     stored record -> migrate -> validate -> RobotConfig
 *
 * A record written by an older build walks the migration ladder; anything that
 * still fails validation is reported per-preset rather than taking down the
 * whole listing. One corrupt row must not cost a user their other robots.
 */

import { migrateRobotConfig } from '../schema/migrations.js';
import { safeParseRobotConfig, type ValidationFailure } from '../schema/robotConfig.schema.js';
import type { RobotConfig } from '../core/robot/robotConfig.js';
import type { KeyValueStore } from './kvStore.js';

/** File extension used for single-robot export. */
export const PRESET_FILE_SUFFIX = '.ftcrobot.json';

export interface StoredPreset {
  readonly config: RobotConfig;
  /** ISO timestamp of the last write. */
  readonly savedAt: string;
}

/** A stored record that could not be loaded, surfaced rather than swallowed. */
export interface BrokenPreset {
  readonly id: string;
  readonly errors: readonly ValidationFailure[];
}

export interface PresetListing {
  readonly presets: readonly StoredPreset[];
  readonly broken: readonly BrokenPreset[];
}

export class PresetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresetError';
  }
}

/**
 * Timestamps are injected rather than read from a clock inside the repository,
 * so tests are deterministic and the module has no ambient time dependency.
 */
export type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

export class PresetRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: Clock = systemClock,
  ) {}

  /**
   * Every readable preset, plus a separate list of records that failed to load.
   * Sorted by name so the UI ordering does not depend on write order.
   */
  async list(): Promise<PresetListing> {
    const entries = await this.store.entries();
    const presets: StoredPreset[] = [];
    const broken: BrokenPreset[] = [];

    for (const [id, raw] of entries) {
      const loaded = this.decode(raw);
      if (loaded.ok) presets.push(loaded.preset);
      else broken.push({ id, errors: loaded.errors });
    }

    presets.sort((a, b) => a.config.name.localeCompare(b.config.name));
    return { presets, broken };
  }

  async load(id: string): Promise<RobotConfig> {
    const raw = await this.store.get(id);
    if (raw === undefined) throw new PresetError(`No preset with id "${id}".`);

    const loaded = this.decode(raw);
    if (!loaded.ok) {
      const detail = loaded.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new PresetError(`Preset "${id}" could not be loaded — ${detail}`);
    }
    return loaded.preset.config;
  }

  async save(config: RobotConfig): Promise<StoredPreset> {
    // Validate on the way in as well as out: a bad record should never reach
    // storage in the first place.
    const result = safeParseRobotConfig(config);
    if (!result.ok) {
      const detail = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw new PresetError(`Refusing to save an invalid robot — ${detail}`);
    }

    const preset: StoredPreset = { config: result.config, savedAt: this.now() };
    await this.store.put(result.config.id, preset);
    return preset;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.store.get(id);
    if (existing === undefined) throw new PresetError(`No preset with id "${id}".`);
    await this.store.delete(id);
  }

  async rename(id: string, name: string): Promise<RobotConfig> {
    const config = await this.load(id);
    const renamed: RobotConfig = { ...config, name };
    await this.save(renamed);
    return renamed;
  }

  /**
   * Copy a preset under a new id, so editing the copy cannot disturb the
   * original.
   */
  async duplicate(id: string, newId: string, name?: string): Promise<RobotConfig> {
    if (newId === id) throw new PresetError('A duplicate needs a different id.');
    if ((await this.store.get(newId)) !== undefined) {
      throw new PresetError(`A preset with id "${newId}" already exists.`);
    }

    const source = await this.load(id);
    const copy: RobotConfig = { ...source, id: newId, name: name ?? `${source.name} copy` };
    await this.save(copy);
    return copy;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.store.get(id)) !== undefined;
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  /** Migrate then validate. The only path by which stored data becomes a config. */
  private decode(
    raw: unknown,
  ):
    | { ok: true; preset: StoredPreset }
    | { ok: false; errors: readonly ValidationFailure[] } {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, errors: [{ path: '', message: 'Stored record is not an object.' }] };
    }

    const record = raw as { config?: unknown; savedAt?: unknown };

    let migrated: unknown;
    try {
      migrated = migrateRobotConfig(record.config);
    } catch (error) {
      return {
        ok: false,
        errors: [{ path: 'config', message: (error as Error).message }],
      };
    }

    const parsed = safeParseRobotConfig(migrated);
    if (!parsed.ok) return { ok: false, errors: parsed.errors };

    return {
      ok: true,
      preset: {
        config: parsed.config,
        savedAt: typeof record.savedAt === 'string' ? record.savedAt : 'unknown',
      },
    };
  }
}

// ------------------------------------------------------------ export/import ---

/** Serialise a robot for sharing. Pretty-printed so it diffs readably in git. */
export function exportPreset(config: RobotConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Parse an exported robot. Runs the same migrate-then-validate path as loading
 * from storage, because a file from a teammate is exactly as untrusted as a
 * record from an older build.
 */
export function importPreset(json: string): RobotConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new PresetError(`File is not valid JSON — ${(error as Error).message}`);
  }

  let migrated: unknown;
  try {
    migrated = migrateRobotConfig(raw);
  } catch (error) {
    throw new PresetError((error as Error).message);
  }

  const parsed = safeParseRobotConfig(migrated);
  if (!parsed.ok) {
    const detail = parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new PresetError(`Imported robot is invalid — ${detail}`);
  }
  return parsed.config;
}

/** Filesystem-safe filename for an exported robot. */
export function presetFilename(config: RobotConfig): string {
  const safe = config.name
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${safe === '' ? 'robot' : safe}${PRESET_FILE_SUFFIX}`;
}
