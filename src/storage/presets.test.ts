import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './kvStore.js';
import {
  PresetError,
  PresetRepository,
  exportPreset,
  importPreset,
  presetFilename,
} from './presets.js';
import { DEFAULT_ROBOT_CONFIG, type RobotConfig } from '../core/robot/robotConfig.js';

const named = (id: string, name: string, patch: Partial<RobotConfig['chassis']> = {}): RobotConfig => ({
  ...DEFAULT_ROBOT_CONFIG,
  id,
  name,
  chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, ...patch },
});

let store: MemoryStore;
let repo: PresetRepository;
let tick = 0;

beforeEach(() => {
  store = new MemoryStore();
  tick = 0;
  repo = new PresetRepository(store, () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}Z`);
});

describe('preset CRUD', () => {
  it('saves and loads a robot unchanged', async () => {
    const config = named('a', 'Alpha');
    await repo.save(config);
    expect(await repo.load('a')).toEqual(config);
  });

  it('persists between repository instances', async () => {
    // Same store, new repository: this is what "survives a reload" means.
    await repo.save(named('a', 'Alpha'));
    const reopened = new PresetRepository(store);
    expect((await reopened.load('a')).name).toBe('Alpha');
  });

  it('lists presets sorted by name, not by write order', async () => {
    await repo.save(named('c', 'Zulu'));
    await repo.save(named('a', 'Alpha'));
    await repo.save(named('b', 'Mike'));

    const { presets } = await repo.list();
    expect(presets.map((p) => p.config.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  it('records a save timestamp', async () => {
    await repo.save(named('a', 'Alpha'));
    const { presets } = await repo.list();
    expect(presets[0]?.savedAt).toMatch(/^2026-01-01T/);
  });

  it('overwrites on re-save', async () => {
    await repo.save(named('a', 'Alpha', { massLb: 32 }));
    await repo.save(named('a', 'Alpha', { massLb: 40 }));

    const { presets } = await repo.list();
    expect(presets).toHaveLength(1);
    expect(presets[0]?.config.chassis.massLb).toBe(40);
  });

  it('deletes', async () => {
    await repo.save(named('a', 'Alpha'));
    expect(await repo.exists('a')).toBe(true);
    await repo.remove('a');
    expect(await repo.exists('a')).toBe(false);
  });

  it('renames without changing anything else', async () => {
    const original = named('a', 'Alpha', { massLb: 41 });
    await repo.save(original);

    const renamed = await repo.rename('a', 'Bravo');
    expect(renamed.name).toBe('Bravo');
    expect(renamed.chassis.massLb).toBe(41);
    expect(renamed.id).toBe('a');
  });

  it('duplicates under a new id, leaving the original alone', async () => {
    await repo.save(named('a', 'Alpha', { massLb: 32 }));
    const copy = await repo.duplicate('a', 'b');

    expect(copy.id).toBe('b');
    expect(copy.name).toBe('Alpha copy');

    // Editing the copy must not touch the original.
    await repo.save({ ...copy, chassis: { ...copy.chassis, massLb: 50 } });
    expect((await repo.load('a')).chassis.massLb).toBe(32);
    expect((await repo.load('b')).chassis.massLb).toBe(50);
  });

  it('accepts an explicit name when duplicating', async () => {
    await repo.save(named('a', 'Alpha'));
    expect((await repo.duplicate('a', 'b', 'Beta')).name).toBe('Beta');
  });
});

describe('preset errors', () => {
  it('reports a missing preset', async () => {
    await expect(repo.load('nope')).rejects.toThrow(PresetError);
    await expect(repo.remove('nope')).rejects.toThrow(/No preset/);
  });

  it('refuses to save an invalid robot', async () => {
    const broken = { ...named('a', 'Alpha'), chassis: { ...DEFAULT_ROBOT_CONFIG.chassis, massLb: -1 } };
    await expect(repo.save(broken)).rejects.toThrow(/Refusing to save/);
    expect(await repo.exists('a')).toBe(false);
  });

  it('refuses to duplicate onto an existing id', async () => {
    await repo.save(named('a', 'Alpha'));
    await repo.save(named('b', 'Bravo'));
    await expect(repo.duplicate('a', 'b')).rejects.toThrow(/already exists/);
    await expect(repo.duplicate('a', 'a')).rejects.toThrow(/different id/);
  });
});

describe('corrupt records are isolated, not fatal', () => {
  /**
   * One bad row must not cost a user their other robots — the listing reports
   * it separately and keeps going.
   */
  it('keeps listing good presets alongside a broken one', async () => {
    await repo.save(named('good', 'Good Robot'));
    await store.put('bad', { config: { schemaVersion: 1, id: 'bad' }, savedAt: 'x' });
    await store.put('garbage', 'not even an object');

    const { presets, broken } = await repo.list();
    expect(presets.map((p) => p.config.id)).toEqual(['good']);
    expect(broken.map((b) => b.id).sort()).toEqual(['bad', 'garbage']);
    expect(broken[0]?.errors.length).toBeGreaterThan(0);
  });

  it('explains why a specific preset will not load', async () => {
    await store.put('bad', { config: { schemaVersion: 99, id: 'bad' }, savedAt: 'x' });
    await expect(repo.load('bad')).rejects.toThrow(/newer than this build/);
  });

  it('reports an unknown motor rather than silently substituting one', async () => {
    const config = { ...named('a', 'Alpha'), drivetrain: { ...DEFAULT_ROBOT_CONFIG.drivetrain, motorId: 'gone' } };
    await store.put('a', { config, savedAt: 'x' });

    const { broken } = await repo.list();
    expect(broken[0]?.errors[0]?.message).toMatch(/Unknown motor/);
  });
});

describe('export and import', () => {
  it('round-trips a robot exactly', () => {
    const config = named('a', 'Alpha', { massLb: 37.5 });
    expect(importPreset(exportPreset(config))).toEqual(config);
  });

  it('produces readable, newline-terminated JSON', () => {
    const text = exportPreset(named('a', 'Alpha'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "name": "Alpha"');
  });

  it('validates imported files as strictly as stored records', () => {
    expect(() => importPreset('{ not json')).toThrow(/not valid JSON/);
    expect(() => importPreset('{"schemaVersion":1}')).toThrow(/invalid/);
    expect(() => importPreset('42')).toThrow(/not an object/);
  });

  it('rejects a file from a newer build with a useful message', () => {
    const future = JSON.stringify({ ...named('a', 'Alpha'), schemaVersion: 99 });
    expect(() => importPreset(future)).toThrow(/newer than this build/);
  });

  it('builds a filesystem-safe filename', () => {
    expect(presetFilename(named('a', 'High Throughput Scorer'))).toBe(
      'high-throughput-scorer.ftcrobot.json',
    );
    expect(presetFilename(named('a', 'Bot #1 / v2'))).toBe('bot-1-v2.ftcrobot.json');
    expect(presetFilename(named('a', '???'))).toBe('robot.ftcrobot.json');
  });

  it('imports a file into the repository', async () => {
    const config = named('shared', 'From Teammate');
    const imported = importPreset(exportPreset(config));
    await repo.save(imported);
    expect((await repo.load('shared')).name).toBe('From Teammate');
  });
});

describe('memory store semantics', () => {
  it('does not hand back a mutable reference to stored data', async () => {
    // A store that returned a live reference would let a caller mutate the
    // "persisted" record without saving, which a real backend never does.
    const store = new MemoryStore();
    const value = { nested: { count: 1 } };
    await store.put('k', value);
    value.nested.count = 99;

    const read = (await store.get('k')) as { nested: { count: number } };
    expect(read.nested.count).toBe(1);
  });

  it('returns undefined for a missing key', async () => {
    expect(await new MemoryStore().get('nope')).toBeUndefined();
  });

  it('clears everything', async () => {
    const store = new MemoryStore();
    await store.put('a', 1);
    await store.put('b', 2);
    await store.clear();
    expect(await store.entries()).toEqual([]);
  });
});
