import type { AgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentHistoryId,
  AgentInput,
  AgentKind,
  ContentBlock,
  MessageId,
  OperationId,
  RunId,
  SessionAutomation,
  SessionId,
  SessionRecord,
  StartOptions,
  TurnId,
  TurnSubmitInput,
  WorkspaceId,
  WorkspaceRecord,
  WorktreeRecord,
} from '@linkcode/schema';
import { Effect, Exit, Semaphore } from 'effect';
import { nullthrow } from 'foxts/guard';
import type { SessionDriver } from '../automation';
import type {
  ConversationTurnService,
  PersistedTurnIntent,
  TerminalOperation,
} from '../conversation/turn-service';
import { mintOperationId, promptBlocksFromContent } from '../conversation/turn-service';
import type { EngineFailure } from '../failure';
import {
  causeToRequestFailure,
  OperationError,
  OperationTimeout,
  RequestError,
  toOperationFailure,
  toRequestFailure,
} from '../failure';
import type { WorkspaceRegistry } from '../workspace/workspace-registry';
import type { WorktreeService } from '../worktree/worktree-service';
import type { HistoryService } from './history-service';
import { decodeLiveBranchCursor } from './live-session';
import type { SessionOrchestrator } from './orchestrator';
import type {
  SessionPin,
  SessionRecordRegistry,
  SessionRunIntent,
} from './session-record-registry';
import { mintRunId } from './session-record-registry';
import type { ResolvedStartOptions, SessionStartOptionsResolver } from './start-options-resolver';

type RunEffect = <A, E>(effect: Effect.Effect<A, E>, options?: Effect.RunOptions) => Promise<A>;

/** A wedged provider dispatch must fail the operation, never the session forever. */
const TURN_SUBMIT_TIMEOUT_MS = 60_000;
/** Launch budget: the claude CLI can legitimately take ~3 minutes to cold-start at peak hours;
 * the other harnesses bound their own startup well under this. */
const LAUNCH_TIMEOUT_MS = 300_000;

export interface TurnSubmitRequest {
  readonly sessionId: SessionId;
  readonly operationId: OperationId;
  readonly input: TurnSubmitInput;
  /** Absent = plain send onto the active leaf; `null` = new root lineage; a turn id = tip-continue
   * or (once checkpoints exist) fork. */
  readonly parentTurnId?: TurnId | null;
  readonly expectedGraphRevision?: number;
}

/** Provider work a submit needs: none (live adapter continues), a cold resume, or a fresh session. */
type TurnLaunch = 'continue' | 'resume' | 'fresh';

function toAgentInput(input: TurnSubmitInput): AgentInput {
  if (input.type !== 'prompt') return input;
  // attachment_ref blocks are refused at admit until the attachment store lands.
  return {
    type: 'prompt',
    content: input.blocks.flatMap((block) =>
      block.type === 'text' ? [{ type: 'text' as const, text: block.text }] : [],
    ),
  };
}

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
    private readonly turns: ConversationTurnService,
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
      const {
        options: resolvedIntent,
        accountId,
        warnings,
      } = yield* startOptions.resolve(options, sessionId);
      const resolved = yield* worktrees.provision(resolvedIntent, sessionId);
      if (options.cwd) {
        const parent = yield* workspaceTouch(workspaces, options.cwd);
        const worktree = worktrees.get(sessionId);
        if (worktree) yield* workspaceRegisterWorktree(workspaces, worktree, parent.workspaceId);
      }
      const now = Date.now();
      const runId = mintRunId();
      const record: SessionRecord = {
        sessionId,
        kind: resolved.kind,
        cwd: resolved.cwd,
        origin: { type: 'created' },
        createdVia: resolved.createdVia,
        createdAt: now,
        updatedAt: now,
        runs: [{ runId, startedAt: now, ...runOf(resolved, accountId) }],
        graphRevision: 0,
        eventEpoch: 0,
      };
      yield* sessions.startLive(
        replyTo,
        record,
        runId,
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
            graphRevision: 0,
            eventEpoch: 0,
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
      const {
        options: resolvedIntent,
        accountId,
        warnings,
      } = yield* resolver.resolve({ ...options, kind }, sessionId);
      const startOptions = yield* worktrees.provision(resolvedIntent, sessionId);
      if (options.cwd) {
        const parent = yield* workspaceTouch(workspaces, options.cwd);
        const worktree = worktrees.get(sessionId);
        if (worktree) yield* workspaceRegisterWorktree(workspaces, worktree, parent.workspaceId);
      }
      const now = Date.now();
      const runId = mintRunId();
      const record: SessionRecord = {
        sessionId,
        kind,
        cwd: startOptions.cwd,
        origin: { type: 'imported', historyId, importedAt: now },
        createdAt: now,
        updatedAt: now,
        runs: [{ runId, historyId, startedAt: now, ...runOf(startOptions, accountId) }],
        graphRevision: 0,
        eventEpoch: 0,
      };
      yield* sessions.startLive(
        replyTo,
        record,
        runId,
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

        const { history, sessions, turns } = this;
        const resolveForRecord = this.resolveForRecord.bind(this);
        const launchRun = this.launchRun.bind(this);
        return Effect.gen(function* () {
          if (yield* turns.hasOpenOperation(sourceSessionId)) {
            return yield* Effect.fail(
              new RequestError({
                code: 'busy',
                message: 'Another operation is open on this session',
              }),
            );
          }
          const resolved = yield* resolveForRecord(source);
          // The runtime rewrite stays destructive for old clients, but the tree records the
          // replacement non-destructively. Live-echo message ids are never persisted, so
          // `sourceMessageId` cannot name a graph turn; best-effort, the replacement lands as a
          // sibling of the active leaf. Nothing is guessed destructively.
          const runId = mintRunId();
          const existingTurns = yield* turns.listTurns(sourceSessionId);
          const activeLeaf = existingTurns.find((turn) => turn.turnId === source.activeLeafTurnId);
          const intent = yield* turns.persistIntent({
            sessionId: sourceSessionId,
            operationId: mintOperationId(),
            runId,
            parentTurnId: activeLeaf?.parentTurnId ?? null,
            input: { type: 'prompt', blocks: promptBlocksFromContent(content) },
          });
          yield* Effect.gen(function* () {
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
            yield* launchRun(
              replyTo,
              source,
              resolved,
              (adapter) =>
                history.branch(
                  adapter,
                  { historyId: sourceHistoryId, cursor: resolvedBranchCursor },
                  resolved.options,
                ),
              {
                initialInput: { type: 'prompt', content },
                preparedTurn: intent,
                registerRecord: false,
                rewindMessageId: sourceMessageId,
                runId,
              },
            );
          }).pipe(
            // The dispatcher does not resolve saga-prepared intents; every failure exit — stop,
            // branch, or dispatch failures, interrupts, defects — resolves here.
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? turns.resolveFailed(intent, causeToRequestFailure(exit.cause)).pipe(
                    Effect.catch(() => Effect.void),
                    Effect.asVoid,
                  )
                : Effect.void,
            ),
          );
        });
      }),
    );
  }

  /**
   * The `turn.submit` saga — idempotent by `operationId`, atomic from the client's view:
   * replay → admit (short critical section) → persist intent (the durable commit point) →
   * provider work + dispatch outside the semaphore under phase-scoped hard timeouts. Every
   * post-persist outcome is committed-or-failed, never absent; the returned terminal operation
   * is the reply.
   */
  submitTurn(request: TurnSubmitRequest): Effect.Effect<TerminalOperation, EngineFailure> {
    const { sessions, turns } = this;
    const admitSubmit = this.admitSubmit.bind(this);
    const relaunchFresh = this.relaunchFresh.bind(this);
    const resumeSession = this.resumeSession.bind(this);
    return Effect.gen(function* () {
      // Replay before any validation: a reply lost to a disconnect must not duplicate a sibling.
      const existing = yield* turns.getOperation(request.operationId);
      if (existing !== undefined) {
        // An operation id names one submit on one session; the same id from another session is a
        // client defect, never a replay — answering would hand it that session's turn.
        if (existing.sessionId !== request.sessionId) {
          return yield* Effect.fail(
            new RequestError({
              code: 'invalid_request',
              message: 'The operation id belongs to another session',
            }),
          );
        }
        if (existing.state !== 'open') return existing;
        return yield* Effect.fail(
          new RequestError({ code: 'busy', message: 'The operation is still in flight' }),
        );
      }
      const { intent, launch } = yield* admitSubmit(request);
      const dispatch = Effect.gen(function* () {
        if (launch !== 'continue') {
          const launchSession =
            launch === 'fresh'
              ? relaunchFresh(request.sessionId, intent.turn.runId)
              : resumeSession(undefined, request.sessionId, {
                  runId: intent.turn.runId,
                  baseTurnId: intent.turn.parentTurnId ?? undefined,
                });
          yield* launchSession.pipe(
            Effect.timeoutOrElse({
              duration: LAUNCH_TIMEOUT_MS,
              orElse: () =>
                Effect.fail(
                  new OperationTimeout({
                    operation: 'turn.submit.launch',
                    duration: LAUNCH_TIMEOUT_MS,
                    publicMessage: 'The provider did not start in time',
                  }),
                ),
            }),
          );
        }
        // The adapter contract emits `running` at dispatch, so a send outliving the timer while
        // the turn is visibly running is committed, not failed — pi-style send() spans the whole
        // turn. commitRunning completes before the race interrupts the losing send fiber, so its
        // exit backstop then sees an already-resolved operation and stands down.
        yield* sessions.sendInput(request.sessionId, toAgentInput(request.input), intent).pipe(
          Effect.timeoutOrElse({
            duration: TURN_SUBMIT_TIMEOUT_MS,
            orElse: (): Effect.Effect<void, OperationError | OperationTimeout> =>
              sessions.isTurnRunning(request.sessionId)
                ? turns.commitRunning(intent)
                : Effect.fail(
                    new OperationTimeout({
                      operation: 'turn.submit',
                      duration: TURN_SUBMIT_TIMEOUT_MS,
                      publicMessage: 'The provider did not accept the turn in time',
                    }),
                  ),
          }),
        );
      });
      return yield* dispatch.pipe(
        Effect.matchEffect({
          onSuccess: () =>
            turns.getOperation(request.operationId).pipe(
              Effect.flatMap((operation) =>
                operation === undefined || operation.state === 'open'
                  ? Effect.fail(
                      new OperationError({
                        subsystem: 'store',
                        operation: 'turn.submit.commit',
                        publicMessage: 'The dispatched turn was not committed',
                        cause: undefined,
                      }),
                    )
                  : Effect.succeed(operation),
              ),
            ),
          // Any post-persist failure resolves the operation; a retry replays this stored error.
          onFailure: (error) => turns.resolveFailed(intent, toRequestFailure(error)),
        }),
        // Interrupts and defects bypass the typed match; the open operation must still resolve,
        // or the session wedges `busy` until the daemon restarts.
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? turns.resolveFailed(intent, causeToRequestFailure(exit.cause)).pipe(
                Effect.catch((error) =>
                  Effect.logError(
                    'Failed to resolve the interrupted turn',
                    { sessionId: request.sessionId },
                    error.cause,
                  ),
                ),
                Effect.asVoid,
              )
            : Effect.void,
        ),
      );
    });
  }

  /**
   * Steps 1–2 of the submit saga under the per-session critical section: typed `busy` while a
   * turn runs or another operation is open, parent/revision validation for explicit-parent
   * submits, then the durable intent persist. At most one operation can be open per session and
   * this section is serialized, so the revision check here is decisive.
   */
  private admitSubmit(
    request: TurnSubmitRequest,
  ): Effect.Effect<{ intent: PersistedTurnIntent; launch: TurnLaunch }, EngineFailure> {
    return this.sessionSemaphore(request.sessionId).withPermit(
      Effect.suspend(() => {
        const record = this.records.get(request.sessionId);
        if (!record) {
          return Effect.fail(
            new RequestError({
              code: 'not_found',
              message: `Unknown session: ${request.sessionId}`,
            }),
          );
        }
        if (this.sessions.isBusy(request.sessionId)) {
          return Effect.fail(
            new RequestError({ code: 'busy', message: `Session is busy: ${request.sessionId}` }),
          );
        }
        if (
          request.input.type === 'prompt' &&
          request.input.blocks.some((block) => block.type === 'attachment_ref')
        ) {
          // Seam: attachment existence/readiness/capability validation lands with the store.
          return Effect.fail(
            new RequestError({
              code: 'unsupported',
              message: 'Prompt attachments are not supported yet',
            }),
          );
        }
        // Seam: the worktree co-leaseholder busy gate joins this critical section later.
        const { sessions, turns } = this;
        return Effect.gen(function* () {
          if (yield* turns.hasOpenOperation(request.sessionId)) {
            return yield* Effect.fail(
              new RequestError({
                code: 'busy',
                message: 'Another operation is open on this session',
              }),
            );
          }
          let parentTurnId: TurnId | null;
          let launch: TurnLaunch;
          if (request.parentTurnId === undefined) {
            // Plain send: no guards — targets the current active leaf under the busy rules alone.
            parentTurnId = record.activeLeafTurnId ?? null;
            launch = 'continue';
          } else if (request.parentTurnId === null) {
            if (request.expectedGraphRevision !== record.graphRevision) {
              return yield* Effect.fail(
                new RequestError({ code: 'conflict', message: 'The conversation graph has moved' }),
              );
            }
            parentTurnId = null;
            launch = 'fresh';
          } else {
            const existingTurns = yield* turns.listTurns(request.sessionId);
            const parent = existingTurns.find((turn) => turn.turnId === request.parentTurnId);
            if (!parent) {
              return yield* Effect.fail(
                new RequestError({
                  code: 'not_found',
                  message: `Unknown turn: ${request.parentTurnId}`,
                }),
              );
            }
            if (parent.state !== 'completed') {
              return yield* Effect.fail(
                new RequestError({
                  code: 'conflict',
                  message: 'The parent turn has not completed',
                }),
              );
            }
            if (request.expectedGraphRevision !== record.graphRevision) {
              return yield* Effect.fail(
                new RequestError({ code: 'conflict', message: 'The conversation graph has moved' }),
              );
            }
            if (request.parentTurnId === record.activeLeafTurnId) {
              // Tip-continue on the active lineage: the provider history head IS this leaf.
              parentTurnId = request.parentTurnId;
              launch = 'continue';
            } else {
              // Fork seam: per-turn provider checkpoints are not captured yet, so this read
              // always finds none and every interior/edit fork is refused loudly.
              const bindings = yield* turns.listBindings(request.parentTurnId);
              return yield* Effect.fail(
                new RequestError({
                  code: 'unsupported',
                  message:
                    bindings.length === 0
                      ? 'This turn has no provider checkpoint to fork from'
                      : 'Forking from an earlier turn is not supported yet',
                }),
              );
            }
          }
          const liveRunId =
            launch === 'continue' ? sessions.liveRunId(request.sessionId) : undefined;
          if (launch === 'continue' && liveRunId === undefined) launch = 'resume';
          const intent = yield* turns.persistIntent({
            sessionId: request.sessionId,
            operationId: request.operationId,
            runId: liveRunId ?? mintRunId(),
            parentTurnId,
            input: request.input,
          });
          return { intent, launch };
        });
      }),
    );
  }

  /** Replace the session's adapter with a fresh provider session under the same LinkCode id —
   * the `parentTurnId: null` (new root lineage) submit path. */
  private relaunchFresh(sessionId: SessionId, runId: RunId): Effect.Effect<void, EngineFailure> {
    return this.sessionSemaphore(sessionId).withPermit(
      Effect.suspend(() => {
        const record = this.records.get(sessionId);
        if (!record) {
          return Effect.fail(
            new RequestError({ code: 'not_found', message: `Unknown session: ${sessionId}` }),
          );
        }
        const { sessions } = this;
        const resolveForRecord = this.resolveForRecord.bind(this);
        const launchRun = this.launchRun.bind(this);
        return Effect.gen(function* () {
          const resolved = yield* resolveForRecord(record);
          yield* sessions.stopForReplacement(sessionId);
          yield* launchRun(
            undefined,
            record,
            resolved,
            (adapter) => sessions.startAdapter(adapter, resolved.options),
            { registerRecord: false, runId },
          );
        });
      }),
    );
  }

  /** Wake a cold session in place under the same LinkCode id. `run` lets a submit pre-mint the
   * relaunch's run identity so the persisted turn references it. */
  resumeSession(
    replyTo: string | undefined,
    sessionId: SessionId,
    run: { runId?: RunId; baseTurnId?: TurnId } = {},
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
        const { workspaces, worktrees } = this;
        const resolveForRecord = this.resolveForRecord.bind(this);
        const launchRun = this.launchRun.bind(this);
        const resumeStrategy = this.resumeStrategy.bind(this);
        return Effect.gen(function* () {
          yield* worktrees.verifyResume(sessionId);
          const resolved = yield* resolveForRecord(record);
          // Register before starting so a persistence failure cannot follow a successful
          // `session.started` reply with a contradictory request failure.
          const worktree = worktrees.get(sessionId);
          if (worktree) {
            const parent = yield* workspaceTouch(workspaces, worktree.repoRoot);
            yield* workspaceRegisterWorktree(workspaces, worktree, parent.workspaceId);
          } else if (record.cwd) {
            yield* workspaceTouch(workspaces, record.cwd);
          }
          yield* launchRun(replyTo, record, resolved, resumeStrategy(historyId, resolved.options), {
            historyId,
            ...run,
          });
        });
      }),
    );
  }

  /**
   * Route an input that changes what a relaunch must replay, and record it once the session has
   * accepted it — a rejected pick never becomes the thread's own choice. Everything else is forwarded
   * untouched, so the client's contract is one `agent.input` request either way.
   */
  applyInput(sessionId: SessionId, input: AgentInput): Effect.Effect<void, unknown> {
    switch (input.type) {
      case 'set-model':
        return this.switchModel(sessionId, input.model, input.accountId);
      case 'set-effort':
        return this.recordAccepted(sessionId, input, { effort: input.effort });
      case 'set-approval-policy':
        return this.recordAccepted(sessionId, input, { approvalPolicyId: input.policyId });
      default:
        return this.sessions.sendInput(sessionId, input);
    }
  }

  /**
   * Point a live session at a model, on `accountId` when the pick names one. Credentials and base URL
   * are injected once at spawn, so a cross-account switch cannot happen in place: it is a relaunch
   * under the same id that resumes the transcript. A switch within the session's own account stays in
   * place, which is why the error channel is the adapter's untyped one rather than
   * {@link EngineFailure}.
   */
  private switchModel(
    sessionId: SessionId,
    model: string,
    accountId?: string,
  ): Effect.Effect<void, unknown> {
    return this.sessionSemaphore(sessionId).withPermit(
      Effect.suspend(() => {
        const record = this.records.get(sessionId);
        if (!record) {
          return Effect.fail(
            new RequestError({ code: 'not_found', message: `Unknown session: ${sessionId}` }),
          );
        }
        if (!this.sessions.has(sessionId)) {
          return Effect.fail(
            new RequestError({
              code: 'conflict',
              message: `Session is not running: ${sessionId}`,
            }),
          );
        }
        // A pick that names no account, or names the session's own, is a switch within the account
        // the run already resolved to: the adapter takes it in place and the run keeps its own.
        if (accountId === undefined || this.records.accountId(sessionId) === accountId) {
          return this.recordAccepted(
            sessionId,
            { type: 'set-model', model, ...(accountId !== undefined && { accountId }) },
            { model },
          );
        }
        if (this.sessions.isBusy(sessionId)) {
          return Effect.fail(
            new RequestError({
              code: 'conflict',
              message: 'The session is busy; switch accounts once the turn has finished',
            }),
          );
        }
        // Relaunching without a transcript would silently start a fresh conversation in place of
        // the one on screen. Losing the thread is worse than refusing the switch.
        const historyId = this.records.historyId(sessionId);
        if (historyId === undefined) {
          return Effect.fail(
            new RequestError({
              code: 'conflict',
              message: 'The session has no provider transcript to carry to another account',
            }),
          );
        }
        // Asked before the teardown below: a refusal from `history.resume` would arrive with the
        // old adapter already gone.
        if (this.sessions.historyCapabilities(sessionId)?.resume !== true) {
          return Effect.fail(
            new RequestError({
              code: 'unsupported',
              message: `${record.kind}: switching account needs history resume, which it does not support`,
            }),
          );
        }

        const { sessions } = this;
        const resolveForRecord = this.resolveForRecord.bind(this);
        const launchRun = this.launchRun.bind(this);
        const resumeStrategy = this.resumeStrategy.bind(this);
        return Effect.gen(function* () {
          const resolved = yield* resolveForRecord(record, { model, accountId });
          yield* sessions.stopForReplacement(sessionId);
          yield* launchRun(
            undefined,
            record,
            resolved,
            resumeStrategy(historyId, resolved.options),
            { historyId, registerRecord: false },
          );
        });
      }),
    );
  }

  /** Forward a pick to the live adapter and record it on the run only if the adapter took it. */
  private recordAccepted(
    sessionId: SessionId,
    input: AgentInput,
    intent: SessionRunIntent,
  ): Effect.Effect<void, unknown> {
    return this.sessions
      .sendInput(sessionId, input)
      .pipe(Effect.tap(() => Effect.sync(() => this.records.setRunIntent(sessionId, intent))));
  }

  /**
   * Resolve the options an existing record relaunches under. Absent an explicit `override`, the
   * thread's own last run supplies the model, account, effort and approval tier: the daemon's
   * configured default answers for new and unpinned sessions, and adopting it here would silently
   * move a running thread to whatever Settings now says.
   */
  private resolveForRecord(
    record: SessionRecord,
    override?: SessionPin,
  ): Effect.Effect<ResolvedStartOptions, EngineFailure> {
    const pinned = override ?? this.records.pinnedOptions(record.sessionId);
    return this.startOptions.resolve(
      { kind: record.kind, cwd: record.cwd, ...pinned },
      record.sessionId,
    );
  }

  /** Record the run this launch begins, then bind the record to a fresh adapter. Every relaunch of
   * an existing record goes through here, so `runs` has exactly one writer. `runId`/`baseTurnId`
   * let a submit pre-mint the run its persisted turn references. */
  private launchRun(
    replyTo: string | undefined,
    record: SessionRecord,
    resolved: ResolvedStartOptions,
    startAdapter: (adapter: AgentAdapter) => Effect.Effect<void, EngineFailure>,
    options: {
      historyId?: AgentHistoryId;
      runId?: RunId;
      baseTurnId?: TurnId;
      initialInput?: AgentInput;
      preparedTurn?: PersistedTurnIntent;
      registerRecord?: boolean;
      rewindMessageId?: MessageId;
    } = {},
  ): Effect.Effect<void, EngineFailure> {
    const { baseTurnId, historyId, runId, ...startOptions } = options;
    return Effect.suspend(() => {
      const launchedRunId = this.records.beginRun(record.sessionId, {
        ...runOf(resolved.options, resolved.accountId),
        historyId,
        runId,
        baseTurnId,
      });
      // The bumped epoch must be durable before the LiveSession exists to mint under it; a lost
      // write here would re-mint the same (epoch, seq) pairs after a reboot, with no gap signal.
      return this.records
        .flush(record.sessionId)
        .pipe(
          Effect.andThen(
            this.sessions.startLive(
              replyTo,
              record,
              launchedRunId,
              startAdapter,
              resolved.warnings,
              startOptions,
            ),
          ),
        );
    });
  }

  /** Wake an adapter onto an existing transcript, or start it fresh when there is none to resume. */
  private resumeStrategy(
    historyId: AgentHistoryId | undefined,
    options: StartOptions,
  ): (adapter: AgentAdapter) => Effect.Effect<void, EngineFailure> {
    const { history, sessions } = this;
    return (adapter) =>
      historyId === undefined
        ? sessions.startAdapter(adapter, options)
        : history.resume(adapter, historyId, options);
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
      const { options: startOptions, accountId } = yield* resolver.resolve(
        { kind: options.kind, cwd: options.cwd, model: options.model },
        sessionId,
      );
      const now = Date.now();
      const runId = mintRunId();
      const record: SessionRecord = {
        sessionId,
        kind: startOptions.kind,
        cwd: startOptions.cwd,
        title: options.title,
        origin: { type: 'created' },
        automation: options.automation,
        createdAt: now,
        updatedAt: now,
        runs: [{ runId, startedAt: now, ...runOf(startOptions, accountId) }],
        graphRevision: 0,
        eventEpoch: 0,
      };
      if (startOptions.cwd) yield* workspaceTouch(workspaces, startOptions.cwd);
      yield* sessions.startLive(undefined, record, runId, (adapter) =>
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

/** What a launch settled on, spread into a `SessionRun`. The account comes from the resolver rather
 * than the options it produced, because only the resolver knows one actually backed the run.
 * Unresolved fields stay absent rather than writing `undefined` into the record, and are what a later
 * relaunch reads back to stay put. */
function runOf(options: StartOptions, accountId: string | undefined): SessionPin {
  return {
    ...(accountId !== undefined && { accountId }),
    ...(options.model !== undefined && { model: options.model }),
    ...(options.effort !== undefined && { effort: options.effort }),
    ...(options.approvalPolicyId !== undefined && { approvalPolicyId: options.approvalPolicyId }),
  };
}
