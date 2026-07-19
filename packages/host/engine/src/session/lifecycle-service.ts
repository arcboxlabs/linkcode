import type {
  AgentHistoryId,
  AgentKind,
  SessionAutomation,
  SessionId,
  SessionRecord,
  StartOptions,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { nullthrow } from 'foxts/guard';
import type { SessionDriver } from '../automation';
import type { WorkspaceRegistry } from '../workspace/workspace-registry';
import type { HistoryService } from './history-service';
import type { SessionOrchestrator } from './orchestrator';
import type { SessionRecordRegistry } from './session-record-registry';
import type { SessionStartOptionsResolver } from './start-options-resolver';

type RunEffect = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

export class SessionLifecycleService {
  readonly driver: SessionDriver;
  private seq = 0;
  private runEffect: RunEffect | undefined;

  constructor(
    private readonly sessions: SessionOrchestrator,
    private readonly records: SessionRecordRegistry,
    private readonly history: HistoryService,
    private readonly startOptions: SessionStartOptionsResolver,
    private readonly workspaces: WorkspaceRegistry,
  ) {
    this.driver = {
      createSession: (options) => this.run(this.createAutomationSession(options)),
      hasRecord: (sessionId) => this.records.has(sessionId),
      isBusy: (sessionId) => this.sessions.isBusy(sessionId),
      ensureLive: (sessionId) =>
        this.sessions.has(sessionId)
          ? Promise.resolve()
          : this.run(this.resumeSession(undefined, sessionId)),
      makeUnattended: (sessionId) => this.run(this.sessions.makeUnattended(sessionId)),
      prompt: (sessionId, text, options) =>
        this.run(this.sessions.prompt(sessionId, text, options)),
      stopSession: (sessionId) => this.run(this.sessions.stopIfLive(sessionId)),
    };
  }

  bindRuntime(runEffect: RunEffect): void {
    this.runEffect = runEffect;
  }

  start(replyTo: string, options: StartOptions): Effect.Effect<void, unknown> {
    const { sessions, startOptions, workspaces } = this;
    const sessionId = this.nextSessionId();
    return Effect.gen(function* () {
      const resolved = yield* fromPromise(() => startOptions.resolve(options));
      const now = Date.now();
      const record: SessionRecord = {
        sessionId,
        kind: resolved.kind,
        cwd: resolved.cwd,
        origin: { type: 'created' },
        createdVia: resolved.createdVia,
        createdAt: now,
        updatedAt: now,
        runs: [{ startedAt: now }],
      };
      if (resolved.cwd) yield* fromPromise(() => workspaces.touch(resolved.cwd));
      yield* sessions.startLive(replyTo, record, (adapter) => adapter.start(resolved));
    });
  }

  importSession(kind: AgentKind, historyId: AgentHistoryId): Effect.Effect<SessionRecord, unknown> {
    const { history, records } = this;
    const sessionId = this.nextSessionId();
    return Effect.gen(function* () {
      // Read one event only: the summary (title/cwd/createdAt) is what the record needs.
      const { session } = yield* fromPromise(() => history.read(kind, { historyId, limit: 1 }));
      const now = Date.now();
      const record: SessionRecord = {
        sessionId,
        kind,
        cwd: session.cwd ?? '',
        title: session.title,
        origin: { type: 'imported', historyId, importedAt: now },
        createdAt: session.createdAt ?? now,
        updatedAt: now,
        runs: [],
      };
      yield* fromPromise(() => records.importRecord(record));
      return record;
    });
  }

  resumeHistory(
    replyTo: string,
    kind: AgentKind,
    historyId: AgentHistoryId,
    options: StartOptions,
  ): Effect.Effect<void, unknown> {
    const { history, sessions, startOptions: resolver, workspaces } = this;
    const sessionId = this.nextSessionId();
    return Effect.gen(function* () {
      const startOptions = yield* fromPromise(() => resolver.resolve({ ...options, kind }));
      const now = Date.now();
      const record: SessionRecord = {
        sessionId,
        kind,
        cwd: startOptions.cwd,
        origin: { type: 'imported', historyId, importedAt: now },
        createdAt: now,
        updatedAt: now,
        runs: [{ historyId, startedAt: now }],
      };
      if (startOptions.cwd) yield* fromPromise(() => workspaces.touch(startOptions.cwd));
      yield* sessions.startLive(replyTo, record, (adapter) =>
        history.resume(adapter, historyId, startOptions),
      );
    });
  }

  /** Wake a cold session in place under the same LinkCode id. */
  resumeSession(replyTo: string | undefined, sessionId: SessionId): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (this.sessions.has(sessionId)) {
        return Effect.fail(new Error(`Session is already running: ${sessionId}`));
      }
      const record = nullthrow(this.records.get(sessionId), `Unknown session: ${sessionId}`);
      // A never-prompted session has no provider transcript to resume from (the adapter only mints one
      // on the first prompt); waking it is a fresh start under the same LinkCode id.
      const historyId = this.records.historyId(sessionId);
      const { history, sessions, startOptions: resolver, workspaces } = this;
      return Effect.gen(function* () {
        const startOptions = yield* fromPromise(() =>
          resolver.resolve({ kind: record.kind, cwd: record.cwd }),
        );
        // Register before starting so a persistence failure cannot follow a successful
        // `session.started` reply with a contradictory request failure.
        if (record.cwd) yield* fromPromise(() => workspaces.touch(record.cwd));
        record.runs.push({ historyId, startedAt: Date.now() });
        yield* sessions.startLive(replyTo, record, (adapter) =>
          historyId === undefined
            ? adapter.start(startOptions)
            : history.resume(adapter, historyId, startOptions),
        );
      });
    });
  }

  private createAutomationSession(options: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    title?: string;
    automation: SessionAutomation;
  }): Effect.Effect<SessionId, unknown> {
    const { sessions, startOptions: resolver, workspaces } = this;
    const sessionId = this.nextSessionId();
    return Effect.gen(function* () {
      const startOptions = yield* fromPromise(() =>
        resolver.resolve({
          kind: options.kind,
          cwd: options.cwd,
          model: options.model,
        }),
      );
      const now = Date.now();
      const record: SessionRecord = {
        sessionId,
        kind: startOptions.kind,
        cwd: startOptions.cwd,
        title: options.title,
        origin: { type: 'created' },
        automation: options.automation,
        createdAt: now,
        updatedAt: now,
        runs: [{ startedAt: now }],
      };
      if (startOptions.cwd) yield* fromPromise(() => workspaces.touch(startOptions.cwd));
      yield* sessions.startLive(undefined, record, (adapter) => adapter.start(startOptions));
      return record.sessionId;
    });
  }

  private nextSessionId(): SessionId {
    this.seq += 1;
    return `sess-${Date.now().toString(36)}-${this.seq.toString(36)}` as SessionId;
  }

  private run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return nullthrow(this.runEffect, 'Session runtime has not started')(effect);
  }
}

function fromPromise<A>(run: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: () => run(), catch: (cause) => cause });
}
