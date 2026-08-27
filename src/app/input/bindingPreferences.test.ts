import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../storage/kvStore.js';
import { DEFAULT_KEY_BINDINGS } from './bindings.js';
import { loadKeyBindings, saveKeyBindings } from './bindingPreferences.js';

describe('keyboard binding preferences', () => {
  it('returns defaults when there is no saved preference', async () => {
    await expect(loadKeyBindings(new MemoryStore())).resolves.toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('round-trips all driver and mechanism bindings', async () => {
    const store = new MemoryStore();
    const bindings = { ...DEFAULT_KEY_BINDINGS, intake: 'KeyI', launch: 'Enter' };

    await saveKeyBindings(store, bindings);
    await expect(loadKeyBindings(store)).resolves.toEqual(bindings);
  });

  it('ignores an incomplete saved map instead of leaving actions undefined', async () => {
    const store = new MemoryStore();
    await store.put('keyboard-bindings-v1', { forward: 'KeyI' });

    await expect(loadKeyBindings(store)).resolves.toEqual(DEFAULT_KEY_BINDINGS);
  });
});
