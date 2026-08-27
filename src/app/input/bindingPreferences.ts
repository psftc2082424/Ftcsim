/** Persistent, validated keyboard-binding preferences for the browser app. */

import type { KeyValueStore } from '../../storage/kvStore.js';
import { DEFAULT_KEY_BINDINGS, DRIVE_ACTIONS, type DriveAction, type KeyBindings } from './bindings.js';

const KEY = 'keyboard-bindings-v1';

function isBindings(value: unknown): value is Record<DriveAction, string> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return DRIVE_ACTIONS.every((action) => typeof candidate[action] === 'string');
}

/** Load a complete binding map, falling back safely after a corrupt/old value. */
export async function loadKeyBindings(store: KeyValueStore): Promise<KeyBindings> {
  const saved = await store.get(KEY);
  if (!isBindings(saved)) return { ...DEFAULT_KEY_BINDINGS };
  return Object.fromEntries(DRIVE_ACTIONS.map((action) => [action, saved[action]])) as KeyBindings;
}

/** Store a detached data copy; later UI mutations cannot alter the saved map. */
export async function saveKeyBindings(store: KeyValueStore, bindings: KeyBindings): Promise<void> {
  await store.put(KEY, Object.fromEntries(DRIVE_ACTIONS.map((action) => [action, bindings[action]])));
}
