import type {
  AgentHistoryId,
  AgentKind,
  ContentBlock,
  SessionId,
  SessionInfo,
  SessionRecord,
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

  constructor(private readonly store: SessionStore) {}

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
    }));
  }

  /** Register before session startup settles; persistence failures must not orphan a live adapter. */
  register(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
    this.persist(record);
  }

  /** Imported records have no live adapter, so a store failure remains request-fatal. */
  importRecord(record: SessionRecord): Effect.Effect<void, OperationError> {
    return storeOperation('session-records.save', 'Failed to persist session record', () =>
      this.store.save(record),
    ).pipe(Effect.tap(() => Effect.sync(() => this.records.set(record.sessionId, record))));
  }

  /** Delete from durable storage first so a failed delete leaves the in-memory record retryable. */
  delete(sessionId: SessionId): Effect.Effect<void, OperationError> {
    return storeOperation('session-records.delete', 'Failed to delete session record', () =>
      this.store.delete(sessionId),
    ).pipe(Effect.tap(() => Effect.sync(() => this.records.delete(sessionId))));
  }

  bindHistoryId(sessionId: SessionId, historyId: AgentHistoryId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.historyId === historyId) return;
    run.historyId = historyId;
    this.persist(record);
  }

  sealCurrentRun(sessionId: SessionId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.endedAt !== undefined) return;
    run.endedAt = Date.now();
    this.persist(record);
  }

  setTitleFromContent(sessionId: SessionId, content: ContentBlock[]): void {
    const record = this.records.get(sessionId);
    if (!record || record.title !== undefined) return;
    const title = titleFromContent(content);
    if (title === undefined) return;
    record.title = title;
    this.persist(record);
  }

  historyId(sessionId: SessionId): AgentHistoryId | undefined {
    const record = this.records.get(sessionId);
    return record ? latestHistoryId(record) : undefined;
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

function latestHistoryId(record: SessionRecord): AgentHistoryId | undefined {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const historyId = record.runs[index].historyId;
    if (historyId !== undefined) return historyId;
  }
  return record.origin.type === 'imported' ? record.origin.historyId : undefined;
}

function titleFromContent(content: ContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type !== 'text') continue;
    const text = block.text.trim().replaceAll(/\s+/g, ' ');
    if (text.length === 0) continue;
    return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text;
  }
  return undefined;
}
