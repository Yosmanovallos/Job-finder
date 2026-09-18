export interface StaleWhileRevalidateCacheOptions<Value> {
  freshForMs: number;
  staleForMs: number;
  maxEntries: number;
  clone: (value: Value) => Value;
  now?: () => number;
  onBackgroundRefreshError?: (error: unknown) => void;
}

interface CacheEntry<Value> {
  value: Value;
  freshUntil: number;
  staleUntil: number;
}

/**
 * Small, bounded in-memory cache for expensive read-only projections.
 *
 * Fresh values are returned directly. Once freshForMs elapses, the last
 * successful value is still returned immediately while exactly one refresh
 * runs in the background. Only a completely cold/too-old key blocks on its
 * loader. Values are cloned both on write and read so callers cannot mutate
 * shared cache state.
 */
export class StaleWhileRevalidateCache<Key, Value> {
  private readonly entries = new Map<Key, CacheEntry<Value>>();
  private readonly pending = new Map<Key, Promise<Value>>();
  private readonly now: () => number;

  constructor(private readonly options: StaleWhileRevalidateCacheOptions<Value>) {
    if (options.freshForMs < 0 || options.staleForMs < 0 || options.maxEntries < 1) {
      throw new Error("Invalid stale-while-revalidate cache configuration.");
    }
    this.now = options.now || Date.now;
  }

  async get(key: Key, loader: () => Promise<Value>): Promise<Value> {
    const cached = this.entries.get(key);
    const now = this.now();

    if (cached) {
      this.touch(key, cached);
      if (cached.freshUntil > now) return this.options.clone(cached.value);

      if (cached.staleUntil > now) {
        if (!this.pending.has(key)) {
          const refresh = this.startRefresh(key, loader);
          void refresh.catch((error) => this.options.onBackgroundRefreshError?.(error));
        }
        return this.options.clone(cached.value);
      }

      this.entries.delete(key);
    }

    return this.options.clone(await this.startRefresh(key, loader));
  }

  private startRefresh(key: Key, loader: () => Promise<Value>): Promise<Value> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const request = (async () => {
      try {
        const loaded = await loader();
        const stored = this.options.clone(loaded);
        const storedAt = this.now();
        this.store(key, {
          value: stored,
          freshUntil: storedAt + this.options.freshForMs,
          staleUntil: storedAt + this.options.freshForMs + this.options.staleForMs
        });
        return stored;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, request);
    return request;
  }

  private touch(key: Key, entry: CacheEntry<Value>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private store(key: Key, entry: CacheEntry<Value>): void {
    this.entries.delete(key);
    while (this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, entry);
  }
}
