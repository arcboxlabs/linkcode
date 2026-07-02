import type { ConversationSeed } from '@linkcode/client-core';
import type { AgentHistoryId, AgentKind } from '@linkcode/schema';
import { AgentEventSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { z } from 'zod';

/**
 * Best-effort persistence for conversation seeds, so reopening the app paints a session's history
 * instantly from the last snapshot while the fresh transcript read revalidates in the background.
 * The provider transcript stays the source of truth — everything here is a disposable derivative:
 * any read/write failure degrades to a cache miss, never to an error surface.
 */

export type SeedCacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Newest-last list of entry keys; the eviction order for the size cap and quota pressure. */
const INDEX_KEY = 'linkcode.seed-index';
const MAX_ENTRIES = 20;

/** Persisted seeds embed the wire version: any protocol bump invalidates them wholesale. */
const PersistedSeedSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  events: z.array(AgentEventSchema),
});

/** Parse results are memoized per storage so render-time loads don't re-parse megabyte JSON. */
const memoByStorage = new WeakMap<SeedCacheStorage, Map<string, ConversationSeed | null>>();

function defaultStorage(): SeedCacheStorage | null {
  // eslint-disable-next-line sukka/react-prefer-foxact-persistent -- imperative fetch-time cache, not render state; foxact's localStorage hooks don't apply
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function entryKey(kind: AgentKind, historyId: AgentHistoryId): string {
  return `linkcode.seed.${kind}.${historyId}`;
}

function memoFor(storage: SeedCacheStorage): Map<string, ConversationSeed | null> {
  let memo = memoByStorage.get(storage);
  if (!memo) {
    memo = new Map();
    memoByStorage.set(storage, memo);
  }
  return memo;
}

function readIndex(storage: SeedCacheStorage): string[] {
  try {
    const raw = storage.getItem(INDEX_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: SeedCacheStorage, index: string[]): void {
  storage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Drop the least recently written entry; callers guarantee a non-empty index. */
function evictOldest(storage: SeedCacheStorage, index: string[]): string[] {
  const [oldest, ...rest] = index;
  storage.removeItem(oldest);
  memoFor(storage).delete(oldest);
  return rest;
}

/**
 * The last persisted snapshot for a session's transcript, or undefined on any miss (absent, stale
 * wire version, unparseable). Loaded seeds carry `uptoSeq: 0`: they predate this connection, so
 * they supersede none of its live events.
 */
export function loadPersistedSeed(
  kind: AgentKind,
  historyId: AgentHistoryId,
  storage: SeedCacheStorage | null = defaultStorage(),
): ConversationSeed | undefined {
  if (!storage) return undefined;
  const key = entryKey(kind, historyId);
  const memo = memoFor(storage);
  const cached = memo.get(key);
  if (cached !== undefined) return cached ?? undefined;

  let seed: ConversationSeed | null = null;
  try {
    const raw = storage.getItem(key);
    if (raw !== null) {
      const parsed = PersistedSeedSchema.safeParse(JSON.parse(raw));
      if (parsed.success) seed = { events: parsed.data.events, uptoSeq: 0 };
      else storage.removeItem(key);
    }
  } catch {
    // Unreadable storage or corrupt JSON both degrade to a cache miss.
  }
  memo.set(key, seed);
  return seed ?? undefined;
}

/** Persist a freshly fetched seed, keeping at most {@link MAX_ENTRIES} snapshots (LRU by write). */
export function persistSeed(
  kind: AgentKind,
  historyId: AgentHistoryId,
  seed: ConversationSeed,
  storage: SeedCacheStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const key = entryKey(kind, historyId);
  const value = JSON.stringify({ v: WIRE_PROTOCOL_VERSION, events: seed.events });
  let index = readIndex(storage).filter((existing) => existing !== key);
  while (index.length >= MAX_ENTRIES) index = evictOldest(storage, index);

  try {
    // Quota pressure: shed oldest entries until the write fits or nothing is left to shed.
    for (;;) {
      try {
        storage.setItem(key, value);
        break;
      } catch (err) {
        if (index.length === 0) throw err;
        index = evictOldest(storage, index);
      }
    }
    writeIndex(storage, [...index, key]);
    memoFor(storage).set(key, { events: seed.events, uptoSeq: 0 });
  } catch (err) {
    // The cache is an optimization; failing to write it must not break the conversation surface.
    console.warn('[LinkCode] failed to persist conversation seed', err);
  }
}
