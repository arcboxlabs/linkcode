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
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';

export const HISTORY_CONVERSION_CACHE_VERSION = 3;

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

  list(
    kind: AgentKind,
    opts: HistoryListOptions = {},
  ): Effect.Effect<AgentHistoryListResult, RequestError | OperationError> {
    const key = listCacheKey(kind, opts);
    const cached = this.listCache.get(key);
    const now = this.now();
    if (cached && !opts.forceRefresh && cached.expiresAt > now) {
      return Effect.succeed(cloneListResult(cached.result));
    }

    const adapter = this.factory(kind);
    if (!adapter.historyCapabilities.list) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: `${kind}: history list is not supported`,
        }),
      );
    }
    return agentHistoryOperation('history.list', 'Failed to list agent history', () =>
      adapter.listHistory(stripForceRefresh(opts)),
    ).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          this.invalidateEventCacheFromList(kind, result.sessions);
          this.listCache.set(key, {
            expiresAt: now + this.ttlMs,
            result: cloneListResult(result),
          });
        }),
      ),
    );
  }

  read(
    kind: AgentKind,
    opts: HistoryReadOptions,
  ): Effect.Effect<AgentHistoryReadResult, RequestError | OperationError> {
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const key = eventCacheKey(kind, opts.historyId);
    const cached = this.eventCache.get(key);
    const now = this.now();

    if (
      cached &&
      !opts.forceRefresh &&
      cached.expiresAt > now &&
      cached.version === HISTORY_CONVERSION_CACHE_VERSION &&
      (!cached.partialCursor || offset < cached.events.length)
    ) {
      return Effect.succeed(sliceEventCache(cached, offset, limit));
    }

    const adapter = this.factory(kind);
    if (!adapter.historyCapabilities.read) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: `${kind}: history read is not supported`,
        }),
      );
    }
    return agentHistoryOperation('history.read', 'Failed to read agent history', () =>
      adapter.readHistory({ historyId: opts.historyId, limit: 1000 }),
    ).pipe(
      Effect.flatMap((fullResult) => {
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
          return Effect.succeed(sliceEventCache(entry, offset, limit));
        }
        return agentHistoryOperation('history.read', 'Failed to read agent history', () =>
          adapter.readHistory(stripForceRefresh(opts)),
        );
      }),
    );
  }

  resume(
    adapter: AgentAdapter,
    historyId: AgentHistoryId,
    startOpts: StartOptions,
  ): Effect.Effect<void, RequestError | OperationError> {
    if (!adapter.historyCapabilities.resume) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: `${adapter.kind}: history resume is not supported`,
        }),
      );
    }
    return agentHistoryOperation('history.resume', 'Failed to resume agent history', () =>
      adapter.resumeHistory({ historyId }, startOpts),
    );
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

function agentHistoryOperation<A>(
  operation: string,
  publicMessage: string,
  run: () => Promise<A>,
): Effect.Effect<A, OperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new OperationError({ subsystem: 'agent', operation, publicMessage, cause }),
  });
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
