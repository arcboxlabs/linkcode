interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Per-key TTL cache with in-flight dedup: concurrent readers of one key share a single load, so any
 * number of polling clients converge onto one underlying subprocess/network call. Failed loads are
 * not cached — the next read retries.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, CacheEntry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(private readonly ttlMs: number) {}

  read(key: string, load: () => Promise<V>): Promise<V> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > Date.now()) return Promise.resolve(entry.value);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = load()
      .catch((err: unknown) => {
        this.inflight.delete(key);
        throw err;
      })
      .then((value) => {
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        this.inflight.delete(key);
        return value;
      });
    this.inflight.set(key, promise);
    return promise;
  }
}
