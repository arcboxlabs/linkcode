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
import { effectiveAttachmentCapability } from '@linkcode/schema';
import { Effect, Exit, Semaphore } from 'effect';
import { nullthrow } from 'foxts/guard';
import {
  admitPromptAttachments,
  assertInlineAttachmentsSupported,
  attachmentIdsFromBlocks,
  uniqueAttachmentIds,
} from '../attachment/admit';
import type { AttachmentStore } from '../attachment/attachment-store';
import type { AttachmentIngest } from '../attachment/ingest';
import type { PromptMaterializer } from '../attachment/materializer';
import type { SessionDriver } from '../automation';
import type { ConversationCheckpointService, ForkCut } from '../conversation/checkpoint-service';
import { hasHiddenPrefix, pathToLeaf } from '../conversation/lineage-attribution';
import type {
  ConversationTurnService,
  PersistedTurnIntent,
  TerminalOperation,
} from '../conversation/turn-service';
import { mintOperationId } from '../conversation/turn-service';
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
import { assertAttachmentContentAllowed } from './attachment-guard';
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
export const LAUNCH_TIMEOUT_MS = 300_000;

export interface TurnSubmitRequest {
  readonly sessionId: SessionId;
  readonly operationId: OperationId;
  readonly input: TurnSubmitInput;
  /** Absent = plain send onto the active leaf; `null` = new root lineage; a turn id = tip-continue
   * or a fork after that turn's checkpoint. */
  readonly parentTurnId?: TurnId | null;
  readonly expectedGraphRevision?: number;
}

/** Provider work a submit needs: none (live adapter continues), a resume (of the latest history,
 * or an inactive lineage's own), a fresh session, or a fork at the parent's checkpoint. */
type TurnLaunch =
  | { readonly type: 'continue' }
  | { readonly type: 'fresh' }
  | { readonly type: 'resume'; readonly historyId?: AgentHistoryId }
  | { readonly type: 'fork'; readonly cut: ForkCut };

function caughtEngineFailure(error: unknown): EngineFailure {
  if (
    error instanceof RequestError ||
    error instanceof OperationError ||
    error instanceof OperationTimeout
  ) {
    return error;
  }
  return new OperationError({
    subsystem: 'store',
    operation: 'attachments.admit',
    publicMessage: 'Attachment validation failed',
    cause: error,
  });
}

function toAgentInput(input: TurnSubmitInput): AgentInput {
  if (input.type !== 'prompt') return input;
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
    private readonly checkpoints: ConversationCheckpointService,
    private readonly attachments: AttachmentStore,
    private readonly materializer: PromptMaterializer,
    private readonly ingest: AttachmentIngest,
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
    const { materializer, sessions, workspaces, worktrees } = this;
    return Effect.gen(function* () {
      const worktree = worktrees.get(sessionId);
      yield* sessions.delete(sessionId);
      // Best-effort: a missed directory is removed at the next boot sweep. Do not await the
      // unlink on the delete reply — `session.delete` of `..` must not block or traverse.
      void materializer.cleanupSession(sessionId).catch((error: unknown) => {
        Effect.runFork(Effect.logWarning('Failed to clean up materialized attachments', error));
      });
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
        const sourceHistoryId = this.records.historyId(sourceSessionId);
        if (!sourceHistoryId && liveCursor.type === 'provider') {
          return Effect.fail(
            new RequestError({
              code: 'conflict',
              message: 'The session has no provider history to rewrite',
            }),
          );
        }

        const { checkpoints, history, ingest, sessions, turns } = this;
        const resolveForRecord = this.resolveForRecord.bind(this);
        const launchRun = this.launchRun.bind(this);
        return Effect.gen(function* () {
          yield* Effect.try({
            try() {
              assertAttachmentContentAllowed(content);
              assertInlineAttachmentsSupported(content, effectiveAttachmentCapability(source.kind));
            },
            catch(error) {
              return caughtEngineFailure(error);
            },
          });
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
          // replacement non-destructively. A live echo's cursor names its turn, so the replacement
          // lands exactly under the edited turn's parent and the cut comes from that parent's
          // checkpoint; a provider cursor (cold-read prompt) names no turn, so the replacement
          // lands beside the active leaf and the cut is the cursor itself. Nothing is guessed.
          const existingTurns = yield* turns.listTurns(sourceSessionId);
          const target =
            liveCursor.type === 'live'
              ? existingTurns.find((turn) => turn.turnId === liveCursor.turnId)
              : undefined;
          if (target === undefined && liveCursor.type === 'live') {
            return yield* Effect.fail(
              new RequestError({
                code: 'conflict',
                message: 'The prompt does not belong to this session',
              }),
            );
          }
          const activeLeaf = existingTurns.find((turn) => turn.turnId === source.activeLeafTurnId);
          const parentTurnId = target ? target.parentTurnId : (activeLeaf?.parentTurnId ?? null);
          let startAdapter: (adapter: AgentAdapter) => Effect.Effect<void, EngineFailure>;
          if (target === undefined) {
            const historyId = nullthrow(sourceHistoryId, 'checked above for provider cursors');
            startAdapter = (adapter) =>
              history.branch(adapter, { historyId, cursor: branchCursor }, resolved.options);
          } else if (target.parentTurnId === null && !hasHiddenPrefix(source, target)) {
            // A root on a created session's first run: nothing precedes it in provider history,
            // so its replacement starts a fresh provider session (the saga's root rule). Any other
            // root — the first recorded prompt of a session older than its turn rows, or of an
            // import — forks after the hidden history before it, or fails typed.
            startAdapter = (adapter) => sessions.startAdapter(adapter, resolved.options);
          } else {
            // Resolved before the intent persists: a checkpoint-less prompt fails typed here
            // instead of leaving a failed sibling behind.
            const cut = yield* checkpoints.forkCutBefore(source, target.turnId);
            if (cut === undefined) {
              return yield* Effect.fail(
                new RequestError({
                  code: 'unsupported',
                  message: 'This prompt has no provider checkpoint to rewrite from',
                }),
              );
            }
            startAdapter = (adapter) => history.branch(adapter, cut, resolved.options);
          }
          const runId = mintRunId();
          const intent = yield* turns.persistIntent({
            sessionId: sourceSessionId,
            operationId: mintOperationId(),
            runId,
            parentTurnId,
            input: { type: 'prompt', blocks: yield* ingest.promptBlocks(content) },
          });
          yield* Effect.gen(function* () {
            yield* sessions.stopForReplacement(sourceSessionId);
            yield* launchRun(replyTo, source, resolved, startAdapter, {
              initialInput: { type: 'prompt', content },
              preparedTurn: intent,
              registerRecord: false,
              rewindMessageId: sourceMessageId,
              runId,
            });
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
    const abandonRelaunch = this.abandonRelaunch.bind(this);
    const relaunch = this.relaunch.bind(this);
    const resumeSession = this.resumeSession.bind(this);
    const materializeSubmitInput = this.materializeSubmitInput.bind(this);
    const { history } = this;
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
      // A relaunch onto other provider history becomes the thread's only if its turn runs; a
      // failed one is unwound, or the next plain send would continue the child's history under
      // the unmoved leaf.
      const unwindLaunch =
        launch.type === 'continue' || (launch.type === 'resume' && launch.historyId === undefined)
          ? Effect.void
          : abandonRelaunch(request.sessionId, intent.turn.runId);
      const dispatch = Effect.gen(function* () {
        if (launch.type !== 'continue') {
          const { runId } = intent.turn;
          const baseTurnId = intent.turn.parentTurnId ?? undefined;
          const { sessionId } = request;
          let launchSession: Effect.Effect<void, EngineFailure>;
          if (launch.type === 'fresh') {
            launchSession = relaunch(sessionId, { runId }, (adapter, options) =>
              sessions.startAdapter(adapter, options),
            );
          } else if (launch.type === 'fork') {
            const { cut } = launch;
            launchSession = relaunch(sessionId, { runId, baseTurnId }, (adapter, options) =>
              history.branch(adapter, cut, options),
            );
          } else if (launch.historyId !== undefined) {
            const { historyId } = launch;
            launchSession = relaunch(
              sessionId,
              { runId, baseTurnId, historyId },
              (adapter, options) => history.resume(adapter, historyId, options),
            );
          } else {
            launchSession = resumeSession(undefined, sessionId, { runId, baseTurnId });
          }
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
        const echoInput = toAgentInput(request.input);
        const adapterInput = yield* materializeSubmitInput(request, intent);
        yield* sessions.sendInput(request.sessionId, echoInput, intent, adapterInput).pipe(
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
          onFailure: (error) =>
            turns.resolveFailed(intent, toRequestFailure(error)).pipe(Effect.tap(unwindLaunch)),
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
                Effect.andThen(unwindLaunch),
              )
            : Effect.void,
        ),
      );
    });
  }

  /** Unwind a relaunch whose turn never ran: the run is marked first, so the thread's history
   * resolves past it even if stopping the child adapter fails. */
  private abandonRelaunch(sessionId: SessionId, runId: RunId): Effect.Effect<void> {
    const { records, sessions } = this;
    return Effect.suspend(() => {
      records.abandonRun(sessionId, runId);
      if (sessions.liveRunId(sessionId) !== runId) return Effect.void;
      return sessions
        .stop(sessionId)
        .pipe(
          Effect.catch((error) =>
            Effect.logError('Failed to stop the abandoned relaunch', { sessionId }, error.cause),
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
        // Seam: the worktree co-leaseholder busy gate joins this critical section later.
        const { checkpoints, records, sessions, turns } = this;
        const admitAttachments = this.admitPromptBlocks.bind(this);
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
            launch = { type: 'continue' };
          } else if (request.parentTurnId === null) {
            if (request.expectedGraphRevision !== record.graphRevision) {
              return yield* Effect.fail(
                new RequestError({ code: 'conflict', message: 'The conversation graph has moved' }),
              );
            }
            parentTurnId = null;
            // Editing "the first prompt" starts fresh only when nothing can precede a root here.
            // The session's FIRST root answers that — a later root, relaunched fresh, would read
            // the earlier runs as hidden history of its own — while the cut anchors on the active
            // lineage's root, whose history holds whatever the hidden prefix is.
            const existingTurns = yield* turns.listTurns(request.sessionId);
            const firstRoot = existingTurns.find(
              (turn) => turn.parentTurnId === null && turn.siblingOrdinal === 1,
            );
            const activeRoot =
              pathToLeaf(
                new Map(existingTurns.map((turn) => [turn.turnId, turn])),
                record.activeLeafTurnId,
              ).at(0) ?? firstRoot;
            const nothingPrecedes =
              firstRoot === undefined
                ? records.historyId(request.sessionId) === undefined
                : !hasHiddenPrefix(record, firstRoot);
            if (nothingPrecedes) {
              launch = { type: 'fresh' };
            } else {
              const forkable = sessions.historyCapabilitiesOf(record.kind).forkAfterTurn === true;
              const cut =
                forkable && activeRoot !== undefined
                  ? yield* checkpoints.forkCutBefore(record, activeRoot.turnId)
                  : undefined;
              if (cut === undefined) {
                return yield* Effect.fail(
                  new RequestError({
                    code: 'unsupported',
                    message: forkable
                      ? 'This turn has no provider checkpoint to fork from'
                      : `${record.kind}: forking from an earlier turn is not supported`,
                  }),
                );
              }
              launch = { type: 'fork', cut };
            }
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
            parentTurnId = request.parentTurnId;
            if (request.parentTurnId === record.activeLeafTurnId) {
              // Tip-continue on the active lineage: the provider history head IS this leaf.
              launch = { type: 'continue' };
            } else {
              // A valid checkpoint forks — including at an inactive tip: pi's fork writes a new
              // file, and the tip's own history may have grown outside LinkCode (CLI/TUI use), so
              // a forking harness never continues a tip blind. Only a harness that cannot fork
              // continues a tip by resuming the history its own run wrote to; an interior turn
              // is fork-unavailable.
              const forkable = sessions.historyCapabilitiesOf(record.kind).forkAfterTurn === true;
              const cut = forkable
                ? yield* checkpoints.forkCutAfter(record, parent.turnId)
                : undefined;
              if (cut !== undefined) {
                launch = { type: 'fork', cut };
              } else if (existingTurns.some((turn) => turn.parentTurnId === parent.turnId)) {
                return yield* Effect.fail(
                  new RequestError({
                    code: 'unsupported',
                    message: forkable
                      ? 'This turn has no provider checkpoint to fork from'
                      : `${record.kind}: forking from an earlier turn is not supported`,
                  }),
                );
              } else if (forkable) {
                return yield* Effect.fail(
                  new RequestError({
                    code: 'unsupported',
                    message: 'This turn has no provider checkpoint to continue from',
                  }),
                );
              } else {
                const historyId = record.runs.find((run) => run.runId === parent.runId)?.historyId;
                if (historyId === undefined) {
                  return yield* Effect.fail(
                    new RequestError({
                      code: 'unsupported',
                      message: 'This turn has no provider history to continue',
                    }),
                  );
                }
                launch = { type: 'resume', historyId };
              }
            }
          }
          const liveRunId =
            launch.type === 'continue' ? sessions.liveRunId(request.sessionId) : undefined;
          if (liveRunId === undefined && launch.type === 'continue') launch = { type: 'resume' };
          if (request.input.type === 'prompt') {
            yield* admitAttachments(record.kind, request.input.blocks);
          }
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

  private admitPromptBlocks(
    kind: AgentKind,
    blocks: Extract<TurnSubmitInput, { type: 'prompt' }>['blocks'],
  ): Effect.Effect<void, EngineFailure> {
    const occurrences = attachmentIdsFromBlocks(blocks);
    const ids = uniqueAttachmentIds(occurrences);
    if (ids.length === 0) return Effect.void;
    const capability = effectiveAttachmentCapability(kind);
    // Refuse before the store load: the same answers `admitPromptAttachments` gives, without an
    // unbounded id list reaching SQLite as one oversized `IN (...)`.
    if (capability === undefined) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported_attachment',
          message: 'Prompt attachments are not supported by this harness',
        }),
      );
    }
    const maxCount =
      (capability.kinds.image?.maxCount ?? 0) + (capability.kinds.file?.maxCount ?? 0);
    if (occurrences.length > maxCount) {
      return Effect.fail(
        new RequestError({ code: 'limit_exceeded', message: 'Too many attachments' }),
      );
    }
    return Effect.tryPromise({
      try: () => this.attachments.listAttachments(ids),
      catch: (cause) =>
        new OperationError({
          subsystem: 'store',
          operation: 'attachments.list',
          publicMessage: 'Failed to load attachments',
          cause,
        }),
    }).pipe(
      Effect.flatMap((stored) =>
        Effect.try({
          try: () => admitPromptAttachments(blocks, stored, capability),
          catch: (error) => caughtEngineFailure(error),
        }),
      ),
    );
  }

  private materializeSubmitInput(
    request: TurnSubmitRequest,
    intent: PersistedTurnIntent,
  ): Effect.Effect<AgentInput, EngineFailure> {
    if (request.input.type !== 'prompt') return Effect.succeed(request.input);
    if (attachmentIdsFromBlocks(request.input.blocks).length === 0) {
      return Effect.succeed(toAgentInput(request.input));
    }
    const record = this.records.get(request.sessionId);
    if (!record) {
      return Effect.fail(
        new RequestError({
          code: 'not_found',
          message: `Unknown session: ${request.sessionId}`,
        }),
      );
    }
    const promptId = intent.turn.input.type === 'prompt' ? intent.turn.input.promptId : null;
    if (promptId === null) return Effect.succeed(toAgentInput(request.input));
    const { materializer } = this;
    const capability = effectiveAttachmentCapability(record.kind);
    return this.turns.getPrompt(promptId).pipe(
      Effect.flatMap((prompt) =>
        prompt === undefined
          ? Effect.fail(
              new RequestError({
                code: 'not_found',
                message: 'The prompt was not persisted',
              }),
            )
          : materializer.prepare(request.sessionId, intent.turn.runId, prompt, capability),
      ),
      Effect.flatMap((prepared) =>
        Effect.try({
          try: (): AgentInput => ({
            type: 'prompt',
            content: materializer.toContentBlocks(prepared),
          }),
          catch: (error) => caughtEngineFailure(error),
        }),
      ),
    );
  }

  /** Replace the session's adapter under the same LinkCode id with one `start`ed on other provider
   * history: a fresh session (new root lineage), a fork at a checkpoint, or an inactive lineage's
   * own history resumed. The source adapter is stopped first — one live adapter per session, and
   * a stopped source is the strongest quiesce a fork can get. `run` pre-mints the relaunch's run
   * identity so the persisted turn references it. */
  private relaunch(
    sessionId: SessionId,
    run: { runId: RunId; baseTurnId?: TurnId; historyId?: AgentHistoryId },
    start: (adapter: AgentAdapter, options: StartOptions) => Effect.Effect<void, EngineFailure>,
  ): Effect.Effect<void, EngineFailure> {
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
            (adapter) => start(adapter, resolved.options),
            { registerRecord: false, ...run },
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
  resolveForRecord(
    record: SessionRecord,
    override?: SessionPin,
    /** The session the options are for: a fork resolves the source's pins for its child, whose
     * own id must own the per-session resources (the simulator MCP endpoint token). */
    sessionId: SessionId = record.sessionId,
  ): Effect.Effect<ResolvedStartOptions, EngineFailure> {
    const pinned = override ?? this.records.pinnedOptions(record.sessionId);
    return this.startOptions.resolve({ kind: record.kind, cwd: record.cwd, ...pinned }, sessionId);
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

  /** The one session-id minter: a second counter could collide within a millisecond. */
  nextSessionId(): SessionId {
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

  /** The per-session critical section every saga admits under, so a fork's admission serializes
   * with the source's own submits and relaunches. */
  sessionSemaphore(sessionId: SessionId): Semaphore.Semaphore {
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
export function runOf(options: StartOptions, accountId: string | undefined): SessionPin {
  return {
    ...(accountId !== undefined && { accountId }),
    ...(options.model !== undefined && { model: options.model }),
    ...(options.effort !== undefined && { effort: options.effort }),
    ...(options.approvalPolicyId !== undefined && { approvalPolicyId: options.approvalPolicyId }),
  };
}
