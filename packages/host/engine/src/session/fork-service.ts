import type {
  ConversationOperation,
  ConversationTurn,
  McpWarning,
  OperationId,
  SessionId,
  SessionRecord,
  TurnId,
} from '@linkcode/schema';
import { Effect, Exit } from 'effect';
import { nullthrow } from 'foxts/guard';
import type { ConversationCheckpointService, ForkCut } from '../conversation/checkpoint-service';
import { pathToLeaf } from '../conversation/lineage-attribution';
import type { ConversationTurnService, TurnFailure } from '../conversation/turn-service';
import { mintTurnId } from '../conversation/turn-service';
import type { EngineFailure } from '../failure';
import {
  causeToRequestFailure,
  OperationError,
  OperationTimeout,
  RequestError,
  toRequestFailure,
} from '../failure';
import type { WorktreeService } from '../worktree/worktree-service';
import type { HistoryService } from './history-service';
import type { SessionLifecycleService } from './lifecycle-service';
import { LAUNCH_TIMEOUT_MS, runOf } from './lifecycle-service';
import type { SessionOrchestrator } from './orchestrator';
import type { SessionRecordRegistry } from './session-record-registry';
import { mintRunId } from './session-record-registry';

export interface SessionForkRequest {
  readonly sourceSessionId: SessionId;
  readonly throughTurnId: TurnId;
  readonly operationId: OperationId;
  readonly expectedGraphRevision: number;
}

/** The reply a fork resolves to: the forked session (with the child start's custom-MCP
 * advisories, which only this reply can carry), or the stored failure a retry replays. */
export type SessionForkResult =
  | {
      readonly state: 'succeeded';
      readonly sessionId: SessionId;
      readonly mcpWarnings: readonly McpWarning[];
    }
  | { readonly state: 'failed'; readonly error: TurnFailure };

type OpenForkOperation = Extract<ConversationOperation, { state: 'open' }> & {
  readonly kind: 'session.fork';
};

interface AdmittedFork {
  readonly source: SessionRecord;
  readonly through: ConversationTurn;
  /** The source lineage root→through, the prefix the child copies. */
  readonly path: ConversationTurn[];
  readonly cut: ForkCut;
  readonly operation: OpenForkOperation;
}

/**
 * The `session.fork` saga — idempotent by `operationId`, mirroring `turn.submit`: replay → admit
 * under the source's critical section and persist the open operation → provider fork + child
 * adapter start outside it under the launch budget → one transaction commits the child record,
 * its copied prefix, and the operation. The source is never stopped or switched. Fork-vs-delete of
 * one source serializes at the store: a deleted source fails the commit (its prompts are gone), a
 * committed child keeps them through the ref-aware purge.
 */
export class SessionForkService {
  constructor(
    private readonly sessions: SessionOrchestrator,
    private readonly records: SessionRecordRegistry,
    private readonly history: HistoryService,
    private readonly worktrees: WorktreeService,
    private readonly turns: ConversationTurnService,
    private readonly checkpoints: ConversationCheckpointService,
    private readonly lifecycle: SessionLifecycleService,
  ) {}

  forkSession(request: SessionForkRequest): Effect.Effect<SessionForkResult, EngineFailure> {
    const { turns } = this;
    const admit = this.admit.bind(this);
    const launchChild = this.launchChild.bind(this);
    return Effect.gen(function* () {
      // Replay before any validation: a reply lost to a disconnect must not fork twice.
      const existing = yield* turns.getOperation(request.operationId);
      if (existing !== undefined) {
        if (existing.sessionId !== request.sourceSessionId) {
          return yield* Effect.fail(
            new RequestError({
              code: 'invalid_request',
              message: 'The operation id belongs to another session',
            }),
          );
        }
        if (existing.state === 'open') {
          return yield* Effect.fail(
            new RequestError({ code: 'busy', message: 'The operation is still in flight' }),
          );
        }
        if (existing.state === 'failed') return { state: 'failed', error: existing.error };
        // A succeeded fork names the child's copied leaf; that turn's session is the child. The
        // start's advisories were delivered once, on the reply that started it.
        const leaf = yield* turns.getTurn(existing.turnId);
        if (leaf === undefined) {
          return yield* Effect.fail(
            new RequestError({ code: 'not_found', message: 'The forked session no longer exists' }),
          );
        }
        return { state: 'succeeded', sessionId: leaf.sessionId, mcpWarnings: [] };
      }
      const admitted = yield* admit(request);
      return yield* launchChild(admitted).pipe(
        Effect.matchEffect({
          onSuccess: (child) => Effect.succeed<SessionForkResult>({ state: 'succeeded', ...child }),
          // Any post-admit failure resolves the operation; a retry replays this stored error.
          onFailure: (error) =>
            turns
              .failOperation(admitted.operation, toRequestFailure(error))
              .pipe(
                Effect.map((stored): SessionForkResult => ({ state: 'failed', error: stored })),
              ),
        }),
        // Interrupts and defects bypass the typed match; the open operation must still resolve,
        // or the source wedges `busy` until the daemon restarts.
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? turns.failOperation(admitted.operation, causeToRequestFailure(exit.cause)).pipe(
                Effect.catch((error) =>
                  Effect.logError(
                    'Failed to resolve the interrupted fork',
                    { sessionId: request.sourceSessionId },
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
   * The short critical section under the source's semaphore: typed `busy` while a turn runs or
   * another operation is open, the through turn must exist and have completed, the revision must
   * match, the harness must fork after a turn and hold a usable cut — then the open operation is
   * the durable commit point of the admission.
   */
  private admit(request: SessionForkRequest): Effect.Effect<AdmittedFork, EngineFailure> {
    return this.lifecycle.sessionSemaphore(request.sourceSessionId).withPermit(
      Effect.suspend(() => {
        const source = this.records.get(request.sourceSessionId);
        if (!source) {
          return Effect.fail(
            new RequestError({
              code: 'not_found',
              message: `Unknown session: ${request.sourceSessionId}`,
            }),
          );
        }
        if (this.sessions.isBusy(source.sessionId)) {
          return Effect.fail(
            new RequestError({ code: 'busy', message: `Session is busy: ${source.sessionId}` }),
          );
        }
        const { checkpoints, sessions, turns, worktrees } = this;
        return Effect.gen(function* () {
          if (yield* turns.hasOpenOperation(source.sessionId)) {
            return yield* Effect.fail(
              new RequestError({
                code: 'busy',
                message: 'Another operation is open on this session',
              }),
            );
          }
          const sourceTurns = yield* turns.listTurns(source.sessionId);
          const through = sourceTurns.find((turn) => turn.turnId === request.throughTurnId);
          if (through === undefined) {
            return yield* Effect.fail(
              new RequestError({
                code: 'not_found',
                message: `Unknown turn: ${request.throughTurnId}`,
              }),
            );
          }
          if (through.state !== 'completed') {
            return yield* Effect.fail(
              new RequestError({ code: 'conflict', message: 'The turn has not completed' }),
            );
          }
          if (request.expectedGraphRevision !== source.graphRevision) {
            return yield* Effect.fail(
              new RequestError({ code: 'conflict', message: 'The conversation graph has moved' }),
            );
          }
          // A managed worktree has exactly one owning session until worktree leases land; the
          // child could not hold the working tree it would share.
          if (worktrees.get(source.sessionId) !== undefined) {
            return yield* Effect.fail(
              new RequestError({
                code: 'unsupported',
                message: 'Forking a session on a managed worktree is not supported yet',
              }),
            );
          }
          if (sessions.historyCapabilitiesOf(source.kind).forkAfterTurn !== true) {
            return yield* Effect.fail(
              new RequestError({
                code: 'unsupported',
                message: `${source.kind}: forking a session is not supported`,
              }),
            );
          }
          // A tip forks too: the two sessions must stop sharing one provider history.
          const cut = yield* checkpoints.forkCutAfter(source, through.turnId);
          if (cut === undefined) {
            return yield* Effect.fail(
              new RequestError({
                code: 'unsupported',
                message: 'This turn has no provider checkpoint to fork from',
              }),
            );
          }
          const path = pathToLeaf(
            new Map(sourceTurns.map((turn) => [turn.turnId, turn])),
            through.turnId,
          );
          const operation: OpenForkOperation = {
            operationId: request.operationId,
            sessionId: source.sessionId,
            kind: 'session.fork',
            state: 'open',
            createdAt: Date.now(),
          };
          yield* turns.persistOperation(operation);
          return { source, through, path, cut, operation };
        });
      }),
    );
  }

  /**
   * The provider work and the commit. The child record is held provisionally while its adapter
   * starts on the forked history — the run's `session-ref` and status must bind to it — and
   * becomes durable only in the transaction that also writes its copied prefix and the operation's
   * success. Every failure exit before that tears the child down; the orphaned provider history is
   * logged, never entered.
   */
  private launchChild(
    admitted: AdmittedFork,
  ): Effect.Effect<
    { readonly sessionId: SessionId; readonly mcpWarnings: readonly McpWarning[] },
    EngineFailure
  > {
    const { history, lifecycle, records, sessions, turns } = this;
    const abandon = this.abandon.bind(this);
    return Effect.gen(function* () {
      const { source, through, path, cut, operation } = admitted;
      const childId = lifecycle.nextSessionId();
      // The source's pins, resolved for the child: per-session resources such as the simulator
      // MCP endpoint token must belong to the child, or its tools act as the source's.
      const resolved = yield* lifecycle.resolveForRecord(source, undefined, childId);
      const now = Date.now();
      const runId = mintRunId();
      const copies: ConversationTurn[] = [];
      let parentTurnId: TurnId | null = null;
      for (let i = 0, len = path.length; i < len; i++) {
        const turnId = mintTurnId();
        // Prompts are shared by reference; the copied lineage is linear, so every ordinal is 1.
        copies.push({
          ...path[i],
          turnId,
          sessionId: childId,
          parentTurnId,
          siblingOrdinal: 1,
          runId,
        });
        parentTurnId = turnId;
      }
      const leafTurnId = nullthrow(
        parentTurnId,
        'a fork copies at least the turn it forks through',
      );
      const child: SessionRecord = {
        sessionId: childId,
        kind: source.kind,
        cwd: source.cwd,
        ...(source.title !== undefined && { title: source.title }),
        origin: { type: 'created' },
        forkOrigin: {
          sourceSessionId: source.sessionId,
          sourceTurnId: through.turnId,
          forkedAt: now,
        },
        createdAt: now,
        updatedAt: now,
        runs: [
          {
            runId,
            baseTurnId: leafTurnId,
            startedAt: now,
            ...runOf(resolved.options, resolved.accountId),
          },
        ],
        activeLeafTurnId: leafTurnId,
        graphRevision: 0,
        eventEpoch: 0,
      };
      records.registerProvisional(child);
      const start = sessions
        .startLive(
          undefined,
          child,
          runId,
          (adapter) => history.branch(adapter, cut, resolved.options),
          resolved.warnings,
          { registerRecord: false },
        )
        .pipe(
          Effect.timeoutOrElse({
            duration: LAUNCH_TIMEOUT_MS,
            orElse: () =>
              Effect.fail(
                new OperationTimeout({
                  operation: 'session.fork.launch',
                  duration: LAUNCH_TIMEOUT_MS,
                  publicMessage: 'The provider did not fork in time',
                }),
              ),
          }),
        );
      // Uninterruptible from the commit to the announcement: a child that is durable but never
      // announced would stay invisible until the next boot.
      const commit = turns
        .commitFork({
          child,
          turns: copies,
          operation: {
            ...operation,
            state: 'succeeded',
            turnId: leafTurnId,
            resolvedAt: Date.now(),
          },
        })
        .pipe(
          Effect.flatMap((transitioned) =>
            transitioned
              ? Effect.sync(() => records.commitProvisional(childId))
              : Effect.fail(
                  new OperationError({
                    subsystem: 'store',
                    operation: 'session.fork.commit',
                    publicMessage: 'The fork was resolved before it committed',
                    cause: undefined,
                  }),
                ),
          ),
          Effect.uninterruptible,
        );
      yield* start.pipe(
        Effect.andThen(commit),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && records.isProvisional(childId) ? abandon(child) : Effect.void,
        ),
      );
      return { sessionId: childId, mcpWarnings: resolved.warnings };
    });
  }

  /** A fork that never committed: stop the child adapter if it started, forget the record. */
  private abandon(child: SessionRecord): Effect.Effect<void> {
    const { records, sessions } = this;
    return Effect.suspend(() => {
      const stop =
        sessions.liveRunId(child.sessionId) === undefined
          ? Effect.void
          : sessions
              .stop(child.sessionId)
              .pipe(
                Effect.catch((error) =>
                  Effect.logError(
                    'Failed to stop the abandoned fork child',
                    { sessionId: child.sessionId },
                    error.cause,
                  ),
                ),
              );
      return stop.pipe(
        Effect.andThen(
          Effect.sync(() => {
            records.discardProvisional(child.sessionId);
          }),
        ),
        Effect.andThen(
          Effect.logWarning('Abandoned a session fork; its provider child history is orphaned', {
            sessionId: child.sessionId,
            sourceSessionId: child.forkOrigin?.sourceSessionId,
            historyId: child.runs[0]?.historyId,
          }),
        ),
      );
    });
  }
}
