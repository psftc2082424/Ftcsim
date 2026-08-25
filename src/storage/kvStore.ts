/**
 * Minimal key/value persistence.
 *
 * An interface rather than a direct IndexedDB dependency for two reasons: the
 * preset logic above it becomes testable without a browser, and swapping the
 * backing store later (a file, a server) touches nothing else.
 *
 * Values are stored structured-cloneable, so plain JSON-shaped objects only.
 */

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  entries(): Promise<ReadonlyArray<readonly [string, unknown]>>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory store. Used by tests, and as the fallback when IndexedDB is
 * unavailable (private browsing, a locked-down profile) so the app degrades to
 * "presets work but do not survive a reload" rather than failing outright.
 */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<unknown> {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
  }

  async entries(): Promise<ReadonlyArray<readonly [string, unknown]>> {
    // Sorted so listings are stable regardless of insertion order.
    return [...this.map.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, raw]) => [key, JSON.parse(raw) as unknown] as const);
  }

  async put(key: string, value: unknown): Promise<void> {
    // Serialise on write so callers cannot mutate stored data through a
    // reference they kept, matching how a real store behaves.
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

const DB_NAME = 'ftc-simulator';
const DB_VERSION = 1;

/** IndexedDB-backed store, one object store per named collection. */
export class IndexedDbStore implements KeyValueStore {
  private db: IDBDatabase | null = null;

  constructor(private readonly storeName: string) {}

  static isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private async open(): Promise<IDBDatabase> {
    if (this.db !== null) return this.db;

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ['presets', 'gameDefinitions', 'replays']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
    });

    return this.db;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const request = action(tx.objectStore(this.storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  }

  async get(key: string): Promise<unknown> {
    return this.run('readonly', (store) => store.get(key));
  }

  async entries(): Promise<ReadonlyArray<readonly [string, unknown]>> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();

      tx.oncomplete = () => {
        const keys = keysRequest.result.map(String);
        const values = valuesRequest.result;
        resolve(keys.map((key, index) => [key, values[index]] as const));
      };
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB listing failed.'));
    });
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.run('readwrite', (store) => store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key));
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.clear());
  }
}

/** IndexedDB where available, memory otherwise. */
export function createStore(storeName: string): KeyValueStore {
  return IndexedDbStore.isAvailable() ? new IndexedDbStore(storeName) : new MemoryStore();
}
