import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { boundedLimit, cursorOffset } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryBranchOptions,
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
import { RESOURCE_CONTEXT_SENTINEL } from '../resource/service';
import { promptContentFingerprint } from './live-session';

export const HISTORY_CONVERSION_CACHE_VERSION = 5;

export type HistoryListOptions = AgentHistoryListOptions & {
  forceRefresh?: boolean;
};

export type HistoryReadOptions = AgentHistoryReadOptions & {
  forceRefresh?: boolean;
};

export interface HistoryServiceOptions {
  ttlMs?: number;
  now?: () => number;
  /** MCP server names the engine injects at session start (start-options-resolver) — passed to
   * cold reads so replayed calls to injected servers resolve like config-declared ones. */
  injectedMcpServerNames?: (kind: AgentKind) => readonly string[];
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
  private readonly historyCwdById = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly injectedMcpServerNames?: (kind: AgentKind) => readonly string[];

  constructor(
    private readonly factory: AdapterFactory,
    opts: HistoryServiceOptions = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 30000;
    this.now = opts.now ?? Date.now;
    this.injectedMcpServerNames = opts.injectedMcpServerNames;
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
          for (const session of result.sessions) {
            const historyKey = eventCacheKey(kind, session.historyId);
            if (opts.cwd) this.historyCwdById.set(historyKey, opts.cwd);
            else this.historyCwdById.delete(historyKey);
          }
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
    const cwd = opts.cwd ?? this.historyCwdById.get(key);
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
    const mcpServerNames = this.injectedMcpServerNames?.(kind);
    const readContext = {
      ...(cwd && { cwd }),
      ...(mcpServerNames?.length && { mcpServerNames }),
    };
    return agentHistoryOperation('history.read', 'Failed to read agent history', () =>
      adapter.readHistory({ historyId: opts.historyId, ...readContext, limit: 1000 }),
    ).pipe(
      Effect.map(sanitizeHistoryResult),
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
          adapter.readHistory({ ...stripForceRefresh(opts), ...readContext }),
        ).pipe(Effect.map(sanitizeHistoryResult));
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

  branch(
    adapter: AgentAdapter,
    opts: AgentHistoryBranchOptions,
    startOpts: StartOptions,
  ): Effect.Effect<void, RequestError | OperationError> {
    const branchHistory = adapter.branchHistory?.bind(adapter);
    if (branchHistory === undefined || adapter.historyCapabilities.branch !== true) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: `${adapter.kind}: history branch is not supported`,
        }),
      );
    }
    return agentHistoryOperation('history.branch', 'Failed to branch agent history', () =>
      branchHistory(opts, startOpts),
    );
  }

  resolveLiveBranchCursor(
    kind: AgentKind,
    historyId: AgentHistoryId,
    cwd: string,
    offsetFromEnd: number,
    contentFingerprint: string,
  ): Effect.Effect<string, RequestError | OperationError> {
    const adapter = this.factory(kind);
    if (!adapter.historyCapabilities.read) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: `${kind}: history read is not supported`,
        }),
      );
    }
    return agentHistoryOperation('history.read', 'Failed to read agent history', async () => {
      const branchablePrompts: Array<{ branchCursor: string; contentFingerprint: string }> = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = sanitizeHistoryResult(
          // eslint-disable-next-line no-await-in-loop -- Provider cursors require serial pagination.
          await adapter.readHistory({ historyId, cwd, limit: 1000, cursor }),
        );
        for (const entry of result.events) {
          if (entry.event.type === 'user-message' && entry.event.branchCursor !== undefined) {
            branchablePrompts.push({
              branchCursor: entry.event.branchCursor,
              contentFingerprint: promptContentFingerprint(entry.event.content),
            });
          }
        }
        cursor = result.cursor;
        if (cursor !== undefined && seenCursors.has(cursor)) {
          throw new Error(`${kind}: history read returned a repeated cursor`);
        }
        if (cursor !== undefined) seenCursors.add(cursor);
      } while (cursor !== undefined);
      const matchingPrompts = branchablePrompts.filter(
        (prompt) => prompt.contentFingerprint === contentFingerprint,
      );
      return matchingPrompts.at(-(offsetFromEnd + 1))?.branchCursor;
    }).pipe(
      Effect.flatMap((cursor) =>
        cursor === undefined
          ? Effect.fail(
              new RequestError({
                code: 'conflict',
                message: 'The prompt does not match the latest provider history',
              }),
            )
          : Effect.succeed(cursor),
      ),
    );
  }

  clear(): void {
    this.listCache.clear();
    this.eventCache.clear();
    this.historyCwdById.clear();
  }

  private invalidateEventCacheFromList(kind: AgentKind, sessions: AgentHistorySession[]): void {
    for (const session of sessions) {
      const key = eventCacheKey(kind, session.historyId);
      const cached = this.eventCache.get(key);
      if (cached && cached.fingerprint !== sessionFingerprint(session)) this.eventCache.delete(key);
    }
  }
}

function sanitizeHistoryResult(result: AgentHistoryReadResult): AgentHistoryReadResult {
  return {
    ...result,
    events: result.events.map((entry) => ({ ...entry, event: stripResourceContext(entry.event) })),
  };
}

function stripResourceContext(event: AgentEvent): AgentEvent {
  if (event.type !== 'user-message') return event;
  const content = [...event.content];
  const last = content.at(-1);
  if (last?.type !== 'text') return event;
  const marker = last.text.lastIndexOf(RESOURCE_CONTEXT_SENTINEL);
  if (marker < 0 || last.text.slice(marker + RESOURCE_CONTEXT_SENTINEL.length)[0] !== '\n') {
    return event;
  }
  let visibleText = last.text.slice(0, marker);
  if (visibleText.endsWith('\n\n')) visibleText = visibleText.slice(0, -2);
  else if (visibleText.endsWith('\n')) visibleText = visibleText.slice(0, -1);
  if (visibleText.length === 0) content.pop();
  else content[content.length - 1] = { type: 'text', text: visibleText };
  return { ...event, content };
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
