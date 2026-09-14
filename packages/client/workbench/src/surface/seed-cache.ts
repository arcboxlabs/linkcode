import type { ConversationProjectionSeed, ConversationSeed } from '@linkcode/client-core';
import type { AgentHistoryId, AgentKind, SessionId } from '@linkcode/schema';
import {
  AgentEventSchema,
  ConversationReadItemSchema,
  TurnIdSchema,
  WIRE_PROTOCOL_VERSION,
} from '@linkcode/schema';
import { z } from 'zod';

/**
 * Best-effort persistence for conversation seeds: reopening the app paints history instantly
 * while the fresh read revalidates. The daemon stays the source of truth — any read/write failure
 * degrades to a cache miss, never to an error surface.
 */

export type SeedCacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type PersistedSeed = ConversationSeed | ConversationProjectionSeed;

/** Newest-last list of entry keys; the eviction order for the size cap and quota pressure. */
const INDEX_KEY = 'linkcode.seed-index';
const MAX_ENTRIES = 20;

/** Persisted seeds embed the wire version: any protocol bump invalidates them wholesale.
 * (Entries in the pre-`ts` shape fail this parse and degrade to a cache miss.) */
const PersistedSeedSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  events: z.array(z.object({ event: AgentEventSchema, ts: z.number().optional() })),
});

/** A projection snapshot keyed by session. Loaded without its watermark: a cached cut belongs to
 * a connection that is gone, so the seed supersedes nothing and the fresh read takes over. */
const PersistedProjectionSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  graphRevision: z.number().int().nonnegative(),
  leafTurnId: TurnIdSchema,
  items: z.array(ConversationReadItemSchema),
});

/** Parse results are memoized per storage so render-time loads don't re-parse megabyte JSON. */
const memoByStorage = new WeakMap<SeedCacheStorage, Map<string, PersistedSeed | null>>();

function defaultStorage(): SeedCacheStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function historyKey(kind: AgentKind, historyId: AgentHistoryId): string {
  return `linkcode.seed.${kind}.${historyId}`;
}

function projectionKey(sessionId: SessionId): string {
  return `linkcode.conversation.${sessionId}`;
}

function memoFor(storage: SeedCacheStorage): Map<string, PersistedSeed | null> {
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

/** The memoized parse of one entry, or undefined on any miss (absent, stale wire version,
 * unparseable). Keys of the two entry kinds never collide, so the memo can hold both. */
function load<T extends PersistedSeed>(
  storage: SeedCacheStorage,
  key: string,
  parse: (raw: unknown) => T | undefined,
): T | undefined {
  const memo = memoFor(storage);
  const cached = memo.get(key);
  if (cached !== undefined) return (cached ?? undefined) as T | undefined;

  let seed: T | undefined;
  try {
    const raw = storage.getItem(key);
    // A stale/corrupt entry is only *recorded* as a miss: this runs during render, which must
    // stay pure — no removeItem. The next persist overwrites; LRU eviction bounds the rest.
    if (raw !== null) seed = parse(JSON.parse(raw));
  } catch {
    // Unreadable storage or corrupt JSON both degrade to a cache miss.
  }
  memo.set(key, seed ?? null);
  return seed;
}

/** Persist one entry, keeping at most {@link MAX_ENTRIES} snapshots (LRU by write). */
function persist(storage: SeedCacheStorage, key: string, value: string, seed: PersistedSeed): void {
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
    memoFor(storage).set(key, seed);
  } catch (err) {
    // The cache is an optimization; failing to write it must not break the conversation surface.
    // eslint-disable-next-line no-console -- cache failures are non-fatal but still need a developer diagnostic.
    console.warn('[LinkCode] failed to persist conversation seed', err);
  }
}

/** The last persisted transcript snapshot for a history, loaded with `uptoSeq: 0` — it predates
 * this connection. */
export function loadPersistedSeed(
  kind: AgentKind,
  historyId: AgentHistoryId,
  storage: SeedCacheStorage | null = defaultStorage(),
): ConversationSeed | undefined {
  if (!storage) return undefined;
  return load(storage, historyKey(kind, historyId), (raw) => {
    const parsed = PersistedSeedSchema.safeParse(raw);
    return parsed.success ? { events: parsed.data.events, uptoSeq: 0 } : undefined;
  });
}

export function persistSeed(
  kind: AgentKind,
  historyId: AgentHistoryId,
  seed: ConversationSeed,
  storage: SeedCacheStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const value = JSON.stringify({ v: WIRE_PROTOCOL_VERSION, events: seed.events });
  persist(storage, historyKey(kind, historyId), value, { events: seed.events, uptoSeq: 0 });
}

/** The last persisted projection for a session, loaded without its watermark. */
export function loadPersistedProjection(
  sessionId: SessionId,
  storage: SeedCacheStorage | null = defaultStorage(),
): ConversationProjectionSeed | undefined {
  if (!storage) return undefined;
  return load(storage, projectionKey(sessionId), (raw) => {
    const parsed = PersistedProjectionSchema.safeParse(raw);
    if (!parsed.success) return;
    const { graphRevision, leafTurnId, items } = parsed.data;
    return { items, graphRevision, leafTurnId };
  });
}

export function persistProjection(
  sessionId: SessionId,
  seed: ConversationProjectionSeed,
  storage: SeedCacheStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const entry = {
    graphRevision: seed.graphRevision,
    leafTurnId: seed.leafTurnId,
    items: seed.items,
  };
  persist(
    storage,
    projectionKey(sessionId),
    JSON.stringify({ v: WIRE_PROTOCOL_VERSION, ...entry }),
    entry,
  );
}
