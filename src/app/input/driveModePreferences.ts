/** Persistent selection for robot-centric versus field-centric driver input. */

import type { KeyValueStore } from '../../storage/kvStore.js';
import { DEFAULT_DRIVE_MODE, type DriveMode } from './driveMode.js';

const KEY = 'drive-mode-v1';

export async function loadDriveMode(store: KeyValueStore): Promise<DriveMode> {
  const value = await store.get(KEY);
  return value === 'robot' || value === 'field' ? value : DEFAULT_DRIVE_MODE;
}

export async function saveDriveMode(store: KeyValueStore, mode: DriveMode): Promise<void> {
  await store.put(KEY, mode);
}
