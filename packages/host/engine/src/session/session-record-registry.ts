import type {
  AgentHistoryId,
  AgentKind,
  ContentBlock,
  SessionChangeReason,
  SessionId,
  SessionInfo,
  SessionRecord,
  SessionRun,
  StartOptions,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { nullthrow } from 'foxts/guard';
import { OperationError } from '../failure';
import type { SessionStore } from './session-store';

const TITLE_MAX_LENGTH = 80;
type RunTask = (effect: Effect.Effect<void>) => void;

export class SessionRecordRegistry {
  private readonly records = new Map<SessionId, SessionRecord>();
  private runTask: RunTask | undefined;

  /** `onChanged` fires for membership and identity only — never for recency, which would turn a
   * per-turn signal into a list refetch on every client. */
  constructor(
    private readonly store: SessionStore,
    private readonly onChanged: (sessionId: SessionId, reason: SessionChangeReason) => void,
  ) {}

  start(runTask: RunTask): Effect.Effect<void, OperationError> {
    return Effect.sync(() => {
      this.runTask = runTask;
    }).pipe(
      Effect.andThen(
        storeOperation('session-records.load', 'Failed to load session records', () =>
          this.store.load(),
        ),
      ),
      Effect.tap((records) =>
        Effect.sync(() => {
          for (const record of records) this.records.set(record.sessionId, record);
        }),
      ),
      Effect.asVoid,
    );
  }

  has(sessionId: SessionId): boolean {
    return this.records.has(sessionId);
  }

  get(sessionId: SessionId): SessionRecord | undefined {
    return this.records.get(sessionId);
  }

  values(): IterableIterator<SessionRecord> {
    return this.records.values();
  }

  findImported(kind: AgentKind, historyId: AgentHistoryId): SessionRecord | undefined {
    for (const record of this.records.values()) {
      if (
        record.kind === kind &&
        record.origin.type === 'imported' &&
        record.origin.historyId === historyId
      ) {
        return record;
      }
    }
    return undefined;
  }

  list(statusOf: (sessionId: SessionId) => SessionInfo['status'] | undefined): SessionInfo[] {
    return Array.from(this.records.values(), (record) => ({
      sessionId: record.sessionId,
      kind: record.kind,
      cwd: record.cwd,
      status: statusOf(record.sessionId) ?? 'stopped',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      title: record.title,
      origin: record.origin,
      createdVia: record.createdVia,
      automation: record.automation,
      historyId: latestHistoryId(record),
      accountId: latestAccountId(record),
    }));
  }

  /** Register before session startup settles; persistence failures must not orphan a live adapter. */
  register(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
    this.persist(record);
    this.onChanged(record.sessionId, 'created');
  }

  /** Imported records have no live adapter, so a store failure remains request-fatal. */
  importRecord(record: SessionRecord): Effect.Effect<void, OperationError> {
    return storeOperation('session-records.save', 'Failed to persist session record', () =>
      this.store.save(record),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.records.set(record.sessionId, record);
          this.onChanged(record.sessionId, 'created');
        }),
      ),
    );
  }

  /** Delete from durable storage first so a failed delete leaves the in-memory record retryable. */
  delete(sessionId: SessionId): Effect.Effect<void, OperationError> {
    return storeOperation('session-records.delete', 'Failed to delete session record', () =>
      this.store.delete(sessionId),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.records.delete(sessionId);
          this.onChanged(sessionId, 'removed');
        }),
      ),
    );
  }

  bindHistoryId(sessionId: SessionId, historyId: AgentHistoryId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.historyId === historyId) return;
    run.historyId = historyId;
    this.persist(record);
    this.onChanged(sessionId, 'updated');
  }

  /** Record the model the newest run is now on. A pick accepted mid-run never launches anything, so
   * without this a relaunch replays the model the run started with and silently drops it. Not an
   * identity change — `SessionInfo` does not project the model — so it notifies nobody. */
  setRunModel(sessionId: SessionId, model: string): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.model === model) return;
    run.model = model;
    this.persist(record);
  }

  sealCurrentRun(sessionId: SessionId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.endedAt !== undefined) return;
    run.endedAt = Date.now();
    this.persist(record);
  }

  /** The single writer for a relaunch's run entry. `historyId` is known up front only when the
   * relaunch resumes a transcript; a fresh one gets it later via {@link bindHistoryId}. */
  beginRun(sessionId: SessionId, run: Omit<SessionRun, 'startedAt' | 'endedAt'> = {}): void {
    const record = this.records.get(sessionId);
    if (!record) return;
    record.runs.push({ startedAt: Date.now(), ...definedFields(run) });
    this.persist(record);
    // A new run re-points the identity `list()` projects — `accountId`, `historyId` — so clients
    // must revalidate. Nothing else announces a relaunch: it sends no `session.started`, and a
    // resumed run already carries the historyId that would otherwise notify via `bindHistoryId`.
    this.onChanged(sessionId, 'updated');
  }

  setTitleFromContent(sessionId: SessionId, content: ContentBlock[]): void {
    const record = this.records.get(sessionId);
    if (!record || record.title !== undefined) return;
    const title = titleFromContent(content);
    if (title === undefined) return;
    record.title = title;
    this.persist(record);
    this.onChanged(sessionId, 'updated');
  }

  setProviderTitle(sessionId: SessionId, title: string): void {
    const record = this.records.get(sessionId);
    const normalized = title.trim();
    // Automation titles name the durable job/run and must not be replaced by provider metadata.
    if (!record || record.automation || normalized.length === 0 || record.title === normalized) {
      return;
    }
    record.title = normalized;
    this.persist(record);
    this.onChanged(sessionId, 'updated');
  }

  historyId(sessionId: SessionId): AgentHistoryId | undefined {
    const record = this.records.get(sessionId);
    return record ? latestHistoryId(record) : undefined;
  }

  /** The account the newest run resolved to — what a live session is actually talking to. */
  accountId(sessionId: SessionId): string | undefined {
    const record = this.records.get(sessionId);
    return record ? latestAccountId(record) : undefined;
  }

  /**
   * What the newest run resolved to, shaped as a start-options override. A relaunch applies this so
   * the thread keeps its own model and account; the daemon's configured default answers for new and
   * unpinned sessions only, and may have moved since this one started.
   */
  pinnedOptions(sessionId: SessionId): Pick<StartOptions, 'model' | 'config'> | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    const accountId = latestAccountId(record);
    const model = latestModel(record);
    if (accountId === undefined && model === undefined) return undefined;
    return {
      ...(model !== undefined && { model }),
      ...(accountId !== undefined && { config: { accountId } }),
    };
  }

  /** The in-memory record is authoritative while running; persistence is best-effort. */
  private persist(record: SessionRecord): void {
    record.updatedAt = Date.now();
    const runTask = nullthrow(this.runTask, 'Session record registry is not started');
    runTask(
      storeOperation('session-records.save', 'Failed to persist session record', () =>
        this.store.save(record),
      ).pipe(
        Effect.catch((error) =>
          Effect.logError(
            error.publicMessage,
            {
              operation: error.operation,
              subsystem: error.subsystem,
              sessionId: record.sessionId,
            },
            error.cause,
          ),
        ),
      ),
    );
  }
}

function storeOperation<A>(
  operation: string,
  publicMessage: string,
  run: () => Promise<A>,
): Effect.Effect<A, OperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => storeFailure(operation, publicMessage, cause),
  });
}

function storeFailure(operation: string, publicMessage: string, cause: unknown): OperationError {
  return new OperationError({ subsystem: 'store', operation, publicMessage, cause });
}

/** The account the newest run resolved to. Older runs may name a different one — a rebind between
 * runs is legitimate — so only the latest describes what a live session is actually talking to. */
function latestAccountId(record: SessionRecord): string | undefined {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const accountId = record.runs[index].accountId;
    if (accountId !== undefined) return accountId;
  }
  return undefined;
}

function latestModel(record: SessionRecord): string | undefined {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const model = record.runs[index].model;
    if (model !== undefined) return model;
  }
  return undefined;
}

/** Spreading an explicit `undefined` would write the key into the persisted record. */
function definedFields<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function latestHistoryId(record: SessionRecord): AgentHistoryId | undefined {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const historyId = record.runs[index].historyId;
    if (historyId !== undefined) return historyId;
  }
  return record.origin.type === 'imported' ? record.origin.historyId : undefined;
}

const WHITESPACE_RUN_RE = /\s+/g;

function titleFromContent(content: ContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type !== 'text') continue;
    const text = block.text.trim().replaceAll(WHITESPACE_RUN_RE, ' ');
    if (text.length === 0) continue;
    return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text;
  }
  return undefined;
}
