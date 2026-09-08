import { randomUUID } from 'node:crypto';
import type {
  AgentHistoryId,
  AgentKind,
  ContentBlock,
  RunId,
  SessionChangeReason,
  SessionId,
  SessionInfo,
  SessionRecord,
  SessionRun,
  StartOptions,
  TurnId,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { nullthrow } from 'foxts/guard';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { OperationError } from '../failure';
import type { SessionStore } from './session-store';

export function mintRunId(): RunId {
  return `run-${randomUUID()}` as RunId;
}

const TITLE_MAX_LENGTH = 80;
type RunTask = (effect: Effect.Effect<void>) => void;

/** The fields of a run that say what the thread is *set to*, as opposed to how the run went. */
type SessionPinnedRun = Pick<SessionRun, 'accountId' | 'model' | 'effort' | 'approvalPolicyId'>;

/** The same choices shaped as start options, which is how a relaunch replays them. `Pick` over
 * `StartOptions` is the guarantee: a pinned field that a launch cannot accept fails typecheck. */
export type SessionPin = Pick<StartOptions, keyof SessionPinnedRun>;

/** A pick accepted on a live session; absent fields leave the run's current value alone. The account
 * is not among them — credentials are injected at spawn, so moving accounts is a new run. */
export type SessionRunIntent = Omit<SessionPinnedRun, 'accountId'>;

export class SessionRecordRegistry {
  private readonly records = new Map<SessionId, SessionRecord>();
  /** Records held in memory ahead of their durable creation (a fork child mid-saga): events bind
   * to them, but nothing persists or announces them until the creating transaction commits. */
  private readonly provisional = new Set<SessionId>();
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
          for (let i = 0, len = records.length; i < len; i++) {
            const record = records[i];
            // Boot epoch bump, in memory only: nothing mints events before a launch, and every
            // launch persists the record — writing all rows here would churn updatedAt (recency).
            record.eventEpoch += 1;
            this.records.set(record.sessionId, record);
          }
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
    const listed: SessionRecord[] = [];
    for (const record of this.records.values()) {
      if (!this.provisional.has(record.sessionId)) listed.push(record);
    }
    return listed.map((record) => ({
      sessionId: record.sessionId,
      kind: record.kind,
      cwd: record.cwd,
      status: statusOf(record.sessionId) ?? 'stopped',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      title: record.title,
      origin: record.origin,
      forkOrigin: record.forkOrigin,
      createdVia: record.createdVia,
      automation: record.automation,
      historyId: latestHistoryId(record),
      accountId: latestRunValue(record, 'accountId'),
    }));
  }

  /** Register before session startup settles; persistence failures must not orphan a live adapter. */
  register(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
    this.persist(record);
    this.announce(record.sessionId, 'created');
  }

  /** Hold a record that a transaction elsewhere will create: live events bind to it (history id,
   * run identity), `list()` hides it, and {@link persist} skips it until {@link commitProvisional}. */
  registerProvisional(record: SessionRecord): void {
    this.provisional.add(record.sessionId);
    this.records.set(record.sessionId, record);
  }

  /** The creating transaction committed: announce the record and resume persisting it (the
   * upsert also carries anything that bound to it since the transaction's snapshot). */
  commitProvisional(sessionId: SessionId): void {
    const record = this.records.get(sessionId);
    if (!record || !this.provisional.delete(sessionId)) return;
    this.persist(record);
    this.announce(sessionId, 'created');
  }

  isProvisional(sessionId: SessionId): boolean {
    return this.provisional.has(sessionId);
  }

  /** The creating transaction never happened: the record was never durable, so nothing announces
   * its removal. */
  discardProvisional(sessionId: SessionId): void {
    if (!this.provisional.delete(sessionId)) return;
    this.records.delete(sessionId);
  }

  /** Imported records have no live adapter, so a store failure remains request-fatal. */
  importRecord(record: SessionRecord): Effect.Effect<void, OperationError> {
    return storeOperation('session-records.save', 'Failed to persist session record', () =>
      this.store.save(record),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.records.set(record.sessionId, record);
          this.announce(record.sessionId, 'created');
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
          this.announce(sessionId, 'removed');
        }),
      ),
    );
  }

  /** Bind a provider history to the run that reported it — by id, never "the newest row": a
   * replacement adapter's late `session-ref` must not rebind whatever run launched after it. */
  bindHistoryId(sessionId: SessionId, runId: RunId, historyId: AgentHistoryId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.find((candidate) => candidate.runId === runId);
    if (!record || !run || run.historyId === historyId) return;
    run.historyId = historyId;
    this.persist(record);
    this.announce(sessionId, 'updated');
  }

  /**
   * Record a pick the session accepted, on the newest run. A pick accepted mid-run launches nothing,
   * so without this a relaunch replays what the run started with and silently drops it. Callers write
   * only picks — never a value an adapter resolved for itself, which would pin the thread to its own
   * first launch. Not an identity change — `SessionInfo` projects none of these — so it notifies
   * nobody.
   */
  setRunIntent(sessionId: SessionId, intent: SessionRunIntent): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run) return;
    const {
      model = run.model,
      effort = run.effort,
      approvalPolicyId = run.approvalPolicyId,
    } = intent;
    if (model === run.model && effort === run.effort && approvalPolicyId === run.approvalPolicyId) {
      return;
    }
    Object.assign(run, definedFields({ model, effort, approvalPolicyId }));
    this.persist(record);
  }

  /** Seal the run the ending adapter served — by id, so a stale adapter's death cannot stamp
   * `endedAt` onto a replacement run that is still live. */
  sealRun(sessionId: SessionId, runId: RunId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.find((candidate) => candidate.runId === runId);
    if (!record || !run || run.endedAt !== undefined) return;
    run.endedAt = Date.now();
    this.persist(record);
  }

  /** A run launched onto other provider history whose turn never ran: it is sealed and marked so
   * the thread's history resolves past it. */
  abandonRun(sessionId: SessionId, runId: RunId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.find((candidate) => candidate.runId === runId);
    if (!record || !run || run.abandonedAt !== undefined) return;
    const now = Date.now();
    run.abandonedAt = now;
    run.endedAt ??= now;
    this.persist(record);
  }

  /** Whether `runId` is the session's current (newest) run — the source-side gate that drops a
   * replaced adapter's session-scoped events. */
  isCurrentRun(sessionId: SessionId, runId: RunId): boolean {
    return this.records.get(sessionId)?.runs.at(-1)?.runId === runId;
  }

  /** A submit committed: the graph gained a running turn — bump the revision and move the host
   * default leaf. Not an identity change (`SessionInfo` projects neither field), so it notifies
   * nobody; clients follow `conversation.graph.changed`. Returns the new revision. */
  commitGraphMove(sessionId: SessionId, leafTurnId: TurnId): number | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    record.graphRevision += 1;
    record.activeLeafTurnId = leafTurnId;
    this.persist(record);
    return record.graphRevision;
  }

  /** The graph changed shape without moving the default leaf (a sibling failed before it ran):
   * bump the revision so every device's `‹ 1/N ›` re-reads the tree. Returns the new revision. */
  commitGraphShape(sessionId: SessionId): number | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    record.graphRevision += 1;
    this.persist(record);
    return record.graphRevision;
  }

  /** The single writer for a relaunch's run entry. `historyId` is known up front only when the
   * relaunch resumes a transcript; a fresh one gets it later via {@link bindHistoryId}. Returns
   * the run's identity (caller-supplied or minted here) even when the record is gone, so a
   * launch already in flight keeps an addressable run. */
  beginRun(sessionId: SessionId, run: Omit<SessionRun, 'startedAt' | 'endedAt'> = {}): RunId {
    const runId = run.runId ?? mintRunId();
    const record = this.records.get(sessionId);
    if (!record) return runId;
    // A replacement adapter must mint above everything the old one could have minted.
    record.eventEpoch += 1;
    record.runs.push({ startedAt: Date.now(), ...definedFields(run), runId });
    this.persist(record);
    // A new run re-points the identity `list()` projects — `accountId`, `historyId` — so clients
    // must revalidate. Nothing else announces a relaunch: it sends no `session.started`, and a
    // resumed run already carries the historyId that would otherwise notify via `bindHistoryId`.
    this.announce(sessionId, 'updated');
    return runId;
  }

  /** Awaited durable save, for the launch path only: the bumped epoch must reach the store before
   * a LiveSession can mint under it, and a lost write must fail the launch loud — the general
   * fire-and-forget {@link persist} cannot guarantee either. */
  flush(sessionId: SessionId): Effect.Effect<void, OperationError> {
    const record = this.records.get(sessionId);
    if (!record) return Effect.void;
    return storeOperation('session-records.save', 'Failed to persist session record', () =>
      this.store.save(record),
    );
  }

  setTitleFromContent(sessionId: SessionId, content: ContentBlock[]): void {
    const record = this.records.get(sessionId);
    if (!record || record.title !== undefined) return;
    const title = titleFromContent(content);
    if (title === undefined) return;
    record.title = title;
    this.persist(record);
    this.announce(sessionId, 'updated');
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
    this.announce(sessionId, 'updated');
  }

  historyId(sessionId: SessionId): AgentHistoryId | undefined {
    const record = this.records.get(sessionId);
    return record ? latestHistoryId(record) : undefined;
  }

  /** The account the newest run resolved to — what a live session is actually talking to. */
  accountId(sessionId: SessionId): string | undefined {
    const record = this.records.get(sessionId);
    return record ? latestRunValue(record, 'accountId') : undefined;
  }

  /**
   * What the thread is set to, shaped as a start-options override. A relaunch applies this so the
   * thread keeps its own choices; the daemon's configured default answers for new and unpinned
   * sessions only, and may have moved since this one started.
   */
  pinnedOptions(sessionId: SessionId): SessionPin | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    const pin = definedFields({
      accountId: latestRunValue(record, 'accountId'),
      model: latestRunValue(record, 'model'),
      effort: latestRunValue(record, 'effort'),
      approvalPolicyId: latestRunValue(record, 'approvalPolicyId'),
    });
    return isObjectEmpty(pin) ? undefined : pin;
  }

  /** A provisional record has no listing to invalidate: nothing about it reaches clients until it
   * commits. */
  private announce(sessionId: SessionId, reason: SessionChangeReason): void {
    if (this.provisional.has(sessionId)) return;
    this.onChanged(sessionId, reason);
  }

  /** The in-memory record is authoritative while running; persistence is best-effort. */
  private persist(record: SessionRecord): void {
    if (this.provisional.has(record.sessionId)) return;
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

/** The newest run that answers for `key`. Older runs may name a different value — a change between
 * runs is legitimate — so only the latest describes what a live session is actually on. */
function latestRunValue<K extends keyof SessionPinnedRun>(
  record: SessionRecord,
  key: K,
): SessionRun[K] {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const value = record.runs[index][key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Spreading an explicit `undefined` would write the key into the persisted record. */
function definedFields<T extends object>(fields: T): Partial<T> {
  return Object.entries(fields).reduce<Partial<T>>((acc, [key, value]) => {
    if (value !== undefined) (acc as Record<string, unknown>)[key] = value;
    return acc;
  }, {});
}

function latestHistoryId(record: SessionRecord): AgentHistoryId | undefined {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const { historyId, abandonedAt } = record.runs[index];
    if (historyId !== undefined && abandonedAt === undefined) return historyId;
  }
  return record.origin.type === 'imported' ? record.origin.historyId : undefined;
}

const WHITESPACE_RUN_RE = /\s+/g;

function titleFromContent(content: ContentBlock[]): string | undefined {
  for (let i = 0, len = content.length; i < len; i++) {
    const block = content[i];
    if (block.type !== 'text') continue;
    const text = block.text.trim().replaceAll(WHITESPACE_RUN_RE, ' ');
    if (text.length === 0) continue;
    return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text;
  }
  return undefined;
}
