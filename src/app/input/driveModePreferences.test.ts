import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../storage/kvStore.js';
import { loadDriveMode, saveDriveMode } from './driveModePreferences.js';

describe('drive-mode preferences', () => {
  it('defaults safely, round-trips, and ignores corrupt values', async () => {
    const store = new MemoryStore();
    await expect(loadDriveMode(store)).resolves.toBe('robot');

    await saveDriveMode(store, 'field');
    await expect(loadDriveMode(store)).resolves.toBe('field');

    await store.put('drive-mode-v1', 'diagonal');
    await expect(loadDriveMode(store)).resolves.toBe('robot');
  });
});
