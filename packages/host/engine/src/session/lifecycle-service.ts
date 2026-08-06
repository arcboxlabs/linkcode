import type {
  AgentHistoryId,
  AgentKind,
  ContentBlock,
  MessageId,
  SessionAutomation,
  SessionId,
  SessionRecord,
  StartOptions,
  WorkspaceId,
  WorkspaceRecord,
  WorktreeRecord,
} from '@linkcode/schema';
import { Effect, Semaphore } from 'effect';
import { nullthrow } from 'foxts/guard';
import { resolvedAccountId } from '../agent/provider-config';
import type { SessionDriver } from '../automation';
import type { EngineFailure } from '../failure';
import { RequestError, toOperationFailure } from '../failure';
import type { WorkspaceRegistry } from '../workspace/workspace-registry';
import type { WorktreeService } from '../worktree/worktree-service';
import type { HistoryService } from './history-service';
import { decodeLiveBranchCursor } from './live-session';
import type { SessionOrchestrator } from './orchestrator';
import type { SessionRecordRegistry } from './session-record-registry';
import type { SessionStartOptionsResolver } from './start-options-resolver';

type RunEffect = <A, E>(effect: Effect.Effect<A, E>, options?: Effect.RunOptions) => Promise<A>;

export class SessionLifecycleService {
  readonly driver: SessionDriver;
  private readonly importSemaphores = new Map<string, Semaphore.Semaphore>();
  private readonly sessionSemaphores = new Map<SessionId, Semaphore.Semaphore>();
  private seq = 0;
  private runEffect: RunEffect | undefined;

  constructor(
    private readonly sessions: SessionOrchestrator,
    private readonly records: SessionRecordRegistry,
    private readonly history: HistoryService,
    private readonly startOptions: SessionStartOptionsResolver,
    private readonly workspaces: WorkspaceRegistry,
    private readonly worktrees: WorktreeService,
  ) {
    this.driver = {
      createSession: ({ signal, ...options }) =>
        this.run(this.createAutomationSession(options), { signal }),
      hasRecord: (sessionId) => this.records.has(sessionId),
      isBusy: (sessionId) => this.sessions.isBusy(sessionId),
      ensureLive: (sessionId, signal) =>
        this.sessions.has(sessionId)
          ? Promise.resolve()
          : this.run(this.resumeSession(undefined, sessionId), { signal }),
      makeUnattended: (sessionId, signal) =>
        this.run(this.sessions.makeUnattended(sessionId), { signal }),
      prompt: (sessionId, text, options) =>
        this.run(this.sessions.prompt(sessionId, text, options), { signal: options?.signal }),
      stopSession: (sessionId) => this.run(this.sessions.stopIfLive(sessionId)),
    };
  }

  bindRuntime(runEffect: RunEffect): void {
    this.runEffect = runEffect;
  }

  deleteSession(sessionId: SessionId): Effect.Effect<void, EngineFailure> {
    const { sessions, workspaces, worktrees } = this;
    return Effect.gen(function* () {
      const worktree = worktrees.get(sessionId);
      yield* sessions.delete(sessionId);
      yield* worktrees.cleanupDeletedSession(sessionId);
      if (worktree && !worktrees.hasPath(worktree.worktreePath)) {
        const workspace = workspaces.findByCwd(worktree.worktreePath);
        if (workspace) {
          yield* Effect.tryPromise(() => workspaces.archive(workspace.workspaceId)).pipe(
            Effect.catch((error) =>
              Effect.logWarning('Failed to archive cleaned worktree workspace metadata', error),
            ),
          );
        }
      }
    });
  }

  start(replyTo: string, options: StartOptions): Effect.Effect<void, EngineFailure> {
    const { sessions, startOptions, workspaces, worktrees } = this;
    const sessionId = this.nextSessionId();
    return Effect.gen(function* () {
      const { options: resolvedIntent, warnings } = yield* startOptions.resolve(options, sessionId);
      const resolved = yield* worktrees.provision(resolvedIntent, sessionId);
      if (options.cwd) {
        const parent = yield* workspaceTouch(workspaces, options.cwd);
        const worktree = worktrees.get(sessionId);
        if (worktree) yield* workspaceRegisterWorktree(workspaces, worktree, parent.workspaceId);
      }
      const now = Date.now();
      const record: SessionRecord = {
        sessionId,
        kind: resolved.kind,
        cwd: resolved.cwd,
        origin: { type: 'created' },
        createdVia: resolved.createdVia,
        createdAt: now,
        updatedAt: now,
        runs: [{ startedAt: now, ...accountOfRun(resolved) }],
      };
      yield* sessions.startLive(
        replyTo,
        record,
        (adapter) => sessions.startAdapter(adapter, resolved),
        warnings,
      );
    });
  }

  importSession(
    kind: AgentKind,
    historyId: AgentHistoryId,
  ): Effect.Effect<SessionRecord, EngineFailure> {
    const { history, records, workspaces } = this;
    return this.importSemaphore(kind, historyId).withPermit(
      Effect.suspend(() => {
        const existing = records.findImported(kind, historyId);
        if (existing) {
          return existing.cwd
            ? workspaceTouch(workspaces, existing.cwd).pipe(Effect.as(existing))
            : Effect.succeed(existing);
        }

        const sessionId = this.nextSessionId();
        return Effect.gen(function* () {
          // Read one event only: the summary (title/cwd/createdAt) is what the record needs.
          const { session } = yield* history.read(kind, { historyId, limit: 1 });
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
          yield* records.importRecord(record);
          if (record.cwd) yield* workspaceTouch(workspaces, record.cwd);
          return record;
        });
      }),
    );
  }

  resumeHistory(
    replyTo: string,
    kind: AgentKind,
    historyId: AgentHistoryId,
    options: StartOptions,
  ): Effect.Effect<void, EngineFailure> {
    const { history, sessions, startOptions: resolver, workspaces, worktrees } = this;
    const sessionId = this.nextSessionId();
    return Effect.gen(function* () {
      const { options: resolvedIntent, warnings } = yield* resolver.resolve(
        { ...options, kind },
        sessionId,
      );
      const startOptions = yield* worktrees.provision(resolvedIntent, sessionId);
      if (options.cwd) {
        const parent = yield* workspaceTouch(workspaces, options.cwd);
        const worktree = worktrees.get(sessionId);
        if (worktree) yield* workspaceRegisterWorktree(workspaces, worktree, parent.workspaceId);
      }
      const now = Date.now();
      const record: SessionRecord = {
        sessionId,
        kind,
        cwd: startOptions.cwd,
        origin: { type: 'imported', historyId, importedAt: now },
        createdAt: now,
        updatedAt: now,
        runs: [{ historyId, startedAt: now, ...accountOfRun(startOptions) }],
      };
      yield* sessions.startLive(
        replyTo,
        record,
        (adapter) => history.resume(adapter, historyId, startOptions),
        warnings,
      );
    });
  }

  rewritePrompt(
    replyTo: string,
    sourceSessionId: SessionId,
    sourceMessageId: MessageId,
    branchCursor: string,
    content: ContentBlock[],
  ): Effect.Effect<void, EngineFailure> {
    return this.sessionSemaphore(sourceSessionId).withPermit(
      Effect.suspend(() => {
        const source = this.records.get(sourceSessionId);
        if (!source) {
          return Effect.fail(
            new RequestError({
              code: 'not_found',
              message: `Unknown session: ${sourceSessionId}`,
            }),
          );
        }
        const liveCursor = decodeLiveBranchCursor(branchCursor);
        if (liveCursor.type === 'invalid-live') {
          return Effect.fail(
            new RequestError({ code: 'invalid_request', message: 'Invalid live prompt cursor' }),
          );
        }
        if (
          liveCursor.type === 'live' &&
          !source.runs.some((run) => run.historyId === liveCursor.historyId)
        ) {
          return Effect.fail(
            new RequestError({
              code: 'conflict',
              message: 'The prompt history does not belong to this session',
            }),
          );
        }
        const sourceHistoryId =
          liveCursor.type === 'live'
            ? liveCursor.historyId
            : this.records.historyId(sourceSessionId);
        if (!sourceHistoryId) {
          return Effect.fail(
            new RequestError({
              code: 'conflict',
              message: 'The session has no provider history to rewrite',
            }),
          );
        }

        const { history, records, sessions, startOptions: resolver } = this;
        return Effect.gen(function* () {
          const { options: startOptions, warnings } = yield* resolver.resolve(
            { kind: source.kind, cwd: source.cwd },
            sourceSessionId,
          );
          yield* sessions.stopForReplacement(sourceSessionId);
          const resolvedBranchCursor =
            liveCursor.type === 'live'
              ? yield* history.resolveLiveBranchCursor(
                  source.kind,
                  sourceHistoryId,
                  source.cwd,
                  liveCursor.offsetFromEnd,
                  liveCursor.contentFingerprint,
                )
              : branchCursor;
          records.beginRun(sourceSessionId, resolvedAccountId(startOptions));
          yield* sessions.startLive(
            replyTo,
            source,
            (adapter) =>
              history.branch(
                adapter,
                { historyId: sourceHistoryId, cursor: resolvedBranchCursor },
                startOptions,
              ),
            warnings,
            {
              initialInput: { type: 'prompt', content },
              registerRecord: false,
              rewindMessageId: sourceMessageId,
            },
          );
        });
      }),
    );
  }

  /** Wake a cold session in place under the same LinkCode id. */
  resumeSession(
    replyTo: string | undefined,
    sessionId: SessionId,
  ): Effect.Effect<void, EngineFailure> {
    return this.sessionSemaphore(sessionId).withPermit(
      Effect.suspend(() => {
        if (this.sessions.has(sessionId)) {
          return Effect.fail(
            new RequestError({
              code: 'conflict',
              message: `Session is already running: ${sessionId}`,
            }),
          );
        }
        const record = this.records.get(sessionId);
        if (!record) {
          return Effect.fail(
            new RequestError({ code: 'not_found', message: `Unknown session: ${sessionId}` }),
          );
        }
        // A never-prompted session has no provider transcript to resume from (the adapter only mints one
        // on the first prompt); waking it is a fresh start under the same LinkCode id.
        const historyId = this.records.historyId(sessionId);
        const { history, sessions, startOptions: resolver, workspaces, worktrees } = this;
        return Effect.gen(function* () {
          yield* worktrees.verifyResume(sessionId);
          const { options: startOptions, warnings } = yield* resolver.resolve(
            { kind: record.kind, cwd: record.cwd },
            sessionId,
          );
          // Register before starting so a persistence failure cannot follow a successful
          // `session.started` reply with a contradictory request failure.
          const worktree = worktrees.get(sessionId);
          if (worktree) {
            const parent = yield* workspaceTouch(workspaces, worktree.repoRoot);
            yield* workspaceRegisterWorktree(workspaces, worktree, parent.workspaceId);
          } else if (record.cwd) {
            yield* workspaceTouch(workspaces, record.cwd);
          }
          record.runs.push({ historyId, startedAt: Date.now(), ...accountOfRun(startOptions) });
          yield* sessions.startLive(
            replyTo,
            record,
            (adapter) =>
              historyId === undefined
                ? sessions.startAdapter(adapter, startOptions)
                : history.resume(adapter, historyId, startOptions),
            warnings,
          );
        });
      }),
    );
  }

  private createAutomationSession(options: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    title?: string;
    automation: SessionAutomation;
  }): Effect.Effect<SessionId, EngineFailure> {
    const { sessions, startOptions: resolver, workspaces } = this;
    const sessionId = this.nextSessionId();
    return Effect.gen(function* () {
      const { options: startOptions } = yield* resolver.resolve(
        { kind: options.kind, cwd: options.cwd, model: options.model },
        sessionId,
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
        runs: [{ startedAt: now, ...accountOfRun(startOptions) }],
      };
      if (startOptions.cwd) yield* workspaceTouch(workspaces, startOptions.cwd);
      yield* sessions.startLive(undefined, record, (adapter) =>
        sessions.startAdapter(adapter, startOptions),
      );
      return record.sessionId;
    });
  }

  private nextSessionId(): SessionId {
    this.seq += 1;
    return `sess-${Date.now().toString(36)}-${this.seq.toString(36)}` as SessionId;
  }

  private importSemaphore(kind: AgentKind, historyId: AgentHistoryId): Semaphore.Semaphore {
    const key = `${kind}\0${historyId}`;
    const existing = this.importSemaphores.get(key);
    if (existing) return existing;
    const semaphore = Semaphore.makeUnsafe(1);
    this.importSemaphores.set(key, semaphore);
    return semaphore;
  }

  private sessionSemaphore(sessionId: SessionId): Semaphore.Semaphore {
    const existing = this.sessionSemaphores.get(sessionId);
    if (existing) return existing;
    const semaphore = Semaphore.makeUnsafe(1);
    this.sessionSemaphores.set(sessionId, semaphore);
    return semaphore;
  }

  private run<A, E>(effect: Effect.Effect<A, E>, options?: Effect.RunOptions): Promise<A> {
    return nullthrow(this.runEffect, 'Session runtime has not started')(effect, options);
  }
}

function workspaceTouch(
  workspaces: WorkspaceRegistry,
  cwd: string,
): Effect.Effect<WorkspaceRecord, EngineFailure> {
  return Effect.tryPromise({
    try: () => workspaces.touch(cwd),
    catch: (cause) =>
      toOperationFailure(cause, {
        subsystem: 'store',
        operation: 'workspace.touch',
        publicMessage: 'Failed to persist workspace',
      }),
  });
}

function workspaceRegisterWorktree(
  workspaces: WorkspaceRegistry,
  worktree: WorktreeRecord,
  parentWorkspaceId: WorkspaceId,
): Effect.Effect<unknown, EngineFailure> {
  return Effect.tryPromise({
    try: () =>
      workspaces.registerWorktree({
        cwd: worktree.worktreePath,
        parentWorkspaceId,
        branch: worktree.branch,
      }),
    catch: (cause) =>
      toOperationFailure(cause, {
        subsystem: 'store',
        operation: 'workspace.register-worktree',
        publicMessage: 'Failed to persist managed worktree workspace',
      }),
  });
}

/** The run's account, spread into a `SessionRun` so an unresolved one stays absent rather than
 * writing `undefined` into the record. */
function accountOfRun(opts: StartOptions): { accountId?: string } {
  const accountId = resolvedAccountId(opts);
  return accountId === undefined ? {} : { accountId };
}
