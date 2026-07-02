import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { boundedLimit, cursorOffset } from '@linkcode/agent-adapter';
import type {
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistorySession,
  AgentKind,
  StartOptions,
} from '@linkcode/schema';

export const HISTORY_CONVERSION_CACHE_VERSION = 2;

export type HistoryListOptions = AgentHistoryListOptions & {
  forceRefresh?: boolean;
};

export type HistoryReadOptions = AgentHistoryReadOptions & {
  forceRefresh?: boolean;
};

export interface HistoryServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

interface ListCacheEntry {
  expiresAt: number;
  result: AgentHistoryListResult;
}

interface EventCacheEntry {
  expiresAt: number;
  version: number;
  session: AgentHistorySession;
  events: AgentHistoryEvent[];
  fingerprint: string;
  partialCursor?: string;
}

export class HistoryService {
  private readonly listCache = new Map<string, ListCacheEntry>();
  private readonly eventCache = new Map<string, EventCacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly factory: AdapterFactory,
    opts: HistoryServiceOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 30000;
    this.now = opts.now ?? Date.now;
  }

  async list(kind: AgentKind, opts: HistoryListOptions = {}): Promise<AgentHistoryListResult> {
    const key = listCacheKey(kind, opts);
    const cached = this.listCache.get(key);
    const now = this.now();
    if (!opts.forceRefresh && cached && cached.expiresAt > now) {
      return cloneListResult(cached.result);
    }

    const adapter = this.factory(kind);
    if (!adapter.historyCapabilities.list) {
      throw new Error(`${kind}: history list is not supported`);
    }

    const result = await adapter.listHistory(stripForceRefresh(opts));
    this.invalidateEventCacheFromList(kind, result.sessions);
    this.listCache.set(key, {
      expiresAt: now + this.ttlMs,
      result: cloneListResult(result),
    });
    return result;
  }

  async read(kind: AgentKind, opts: HistoryReadOptions): Promise<AgentHistoryReadResult> {
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const key = eventCacheKey(kind, opts.historyId);
    const cached = this.eventCache.get(key);
    const now = this.now();

    if (
      !opts.forceRefresh &&
      cached &&
      cached.expiresAt > now &&
      cached.version === HISTORY_CONVERSION_CACHE_VERSION &&
      (!cached.partialCursor || offset < cached.events.length)
    ) {
      return sliceEventCache(cached, offset, limit);
    }

    const adapter = this.factory(kind);
    if (!adapter.historyCapabilities.read) {
      throw new Error(`${kind}: history read is not supported`);
    }

    const fullResult = await adapter.readHistory({
      historyId: opts.historyId,
      limit: 1000,
    });
    const entry: EventCacheEntry = {
      expiresAt: now + this.ttlMs,
      version: HISTORY_CONVERSION_CACHE_VERSION,
      session: fullResult.session,
      events: [...fullResult.events],
      fingerprint: sessionFingerprint(fullResult.session),
      partialCursor: fullResult.cursor,
    };
    this.eventCache.set(key, entry);

    if (!entry.partialCursor || offset < entry.events.length) {
      return sliceEventCache(entry, offset, limit);
    }

    return adapter.readHistory(stripForceRefresh(opts));
  }

  async resume(
    adapter: AgentAdapter,
    historyId: AgentHistoryId,
    startOpts: StartOptions,
  ): Promise<void> {
    if (!adapter.historyCapabilities.resume) {
      throw new Error(`${adapter.kind}: history resume is not supported`);
    }
    await adapter.resumeHistory({ historyId }, startOpts);
  }

  clear(): void {
    this.listCache.clear();
    this.eventCache.clear();
  }

  private invalidateEventCacheFromList(kind: AgentKind, sessions: AgentHistorySession[]): void {
    for (const session of sessions) {
      const key = eventCacheKey(kind, session.historyId);
      const cached = this.eventCache.get(key);
      if (cached && cached.fingerprint !== sessionFingerprint(session)) this.eventCache.delete(key);
    }
  }
}

function stripForceRefresh<T extends { forceRefresh?: boolean }>(opts: T): Omit<T, 'forceRefresh'> {
  const { forceRefresh: _forceRefresh, ...rest } = opts;
  return rest;
}

function listCacheKey(kind: AgentKind, opts: HistoryListOptions): string {
  return JSON.stringify({
    kind,
    cwd: opts.cwd ?? null,
    cursor: opts.cursor ?? null,
    limit: opts.limit ?? null,
  });
}

function eventCacheKey(kind: AgentKind, historyId: AgentHistoryId): string {
  return `${kind}:${historyId}`;
}

function sessionFingerprint(session: AgentHistorySession): string {
  const metadata = session.metadata ?? {};
  return JSON.stringify({
    historyId: session.historyId,
    updatedAt: session.updatedAt ?? null,
    messageCount: session.messageCount ?? null,
    fileSize: metadata.fileSize ?? null,
    transcriptPath: metadata.transcriptPath ?? null,
  });
}

function sliceEventCache(
  entry: EventCacheEntry,
  offset: number,
  limit: number,
): AgentHistoryReadResult {
  const events = entry.events.slice(offset, offset + limit);
  const cursor =
    offset + limit < entry.events.length
      ? String(offset + limit)
      : entry.partialCursor && offset + limit >= entry.events.length
        ? entry.partialCursor
        : undefined;
  return {
    session: entry.session,
    events,
    cursor,
  };
}

function cloneListResult(result: AgentHistoryListResult): AgentHistoryListResult {
  return {
    sessions: result.sessions.map((session) => ({ ...session })),
    cursor: result.cursor,
  };
}
