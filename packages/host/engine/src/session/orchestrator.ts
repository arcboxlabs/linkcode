import type { AdapterFactory, AgentAdapter, BrowserToolsetFactory } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryCapabilities,
  AgentInput,
  AgentKind,
  ContentBlock,
  McpWarning,
  MessageId,
  RunId,
  SessionId,
  SessionInfo,
  SessionRecord,
} from '@linkcode/schema';
import { userRowMessageId } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Cause, Deferred, Effect, Exit, Scope } from 'effect';
import type { AgentRuntimeService } from '../agent/runtime-service';
import type { AttachmentIngest } from '../attachment/ingest';
import type { TurnResult } from '../automation/turn-watcher';
import { watchTurn } from '../automation/turn-watcher';
import type { ConversationLiveJournals } from '../conversation/live-journal';
import type { ConversationTurnService, PersistedTurnIntent } from '../conversation/turn-service';
import { mintOperationId } from '../conversation/turn-service';
import type { EngineFailure } from '../failure';
import { OperationError, RequestError, toOperationFailure } from '../failure';
import { observeOperation, recordLiveSessions } from '../observability';
import type { ResourceService } from '../resource/service';
import { LiveSession } from './live-session';
import { SessionEventProcessor } from './session-event-processor';
import { SessionInputDispatcher } from './session-input-dispatcher';
import type { SessionRecordRegistry } from './session-record-registry';

export class SessionOrchestrator {
  private readonly sessions = new Map<SessionId, LiveSession>();
  /** Sessions mid-`delete`: a launch admitted during the delete's own store waits must not install
   * a live run whose record is about to vanish (and whose journal the final drop would take). */
  private readonly deleting = new Set<SessionId>();
  private readonly events: SessionEventProcessor;
  private readonly inputs: SessionInputDispatcher;

  constructor(
    private readonly transport: Transport,
    private readonly factory: AdapterFactory,
    private readonly records: SessionRecordRegistry,
    private readonly runtimes: AgentRuntimeService,
    private readonly scope: Scope.Scope,
    reportFailure: (effect: Effect.Effect<void>) => void,
    private readonly onStopped: (sessionId: SessionId) => void,
    private readonly resources: ResourceService,
    private readonly turns: ConversationTurnService,
    private readonly journals: ConversationLiveJournals,
    private readonly ingest: AttachmentIngest,
    private readonly browserTools?: BrowserToolsetFactory,
    private readonly onRunEnded?: (sessionId: SessionId, runId: RunId) => void,
  ) {
    this.events = new SessionEventProcessor(
      transport,
      records,
      runtimes,
      reportFailure,
      resources,
      turns,
      journals,
    );
    this.inputs = new SessionInputDispatcher(records, this.events, resources, turns, ingest);
  }

  private get(sessionId: SessionId): LiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: SessionId): boolean {
    return this.sessions.has(sessionId);
  }

  private remove(sessionId: SessionId, session: LiveSession): boolean {
    if (this.sessions.get(sessionId) !== session) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  list(): SessionInfo[] {
    return this.records
      .list((sessionId) => this.sessions.get(sessionId)?.status)
      .map((session) => ({
        ...session,
        historyCapabilities: this.factory(session.kind).historyCapabilities,
      }));
  }

  isBusy(sessionId: SessionId): boolean {
    const session = this.sessions.get(sessionId);
    return session !== undefined && (session.turnInputActive || session.status === 'running');
  }

  /** The adapter has visibly emitted `running` — deliberately narrower than {@link isBusy}:
   * `turnInputActive` is set by the dispatch itself and proves nothing about acceptance. */
  isTurnRunning(sessionId: SessionId): boolean {
    return this.sessions.get(sessionId)?.status === 'running';
  }

  /** The run the live adapter serves; `undefined` doubles as the cold-session signal. */
  liveRunId(sessionId: SessionId): RunId | undefined {
    return this.sessions.get(sessionId)?.runId;
  }

  /** The running adapter's history capabilities — asked of the live instance rather than a fresh
   * one, so a caller about to tear it down learns what *this* session can do. */
  historyCapabilities(sessionId: SessionId): AgentHistoryCapabilities | undefined {
    return this.sessions.get(sessionId)?.adapter.historyCapabilities;
  }

  /** The harness's static history capabilities, for gating work on a session with no live adapter. */
  historyCapabilitiesOf(kind: AgentKind): AgentHistoryCapabilities {
    return this.factory(kind).historyCapabilities;
  }

  replay(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (session) this.events.broadcast(sessionId, session, session.replay());
  }

  /** Authoritative open interactive requests and their responding statuses — the CODE-35
   * backstop: a conversation read must carry them even when the journal evicted or cut their
   * original events. */
  openInteractiveRequests(sessionId: SessionId): AgentEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.interactions
      .replay()
      .filter(
        (event) =>
          event.type === 'permission-request' ||
          event.type === 'question-request' ||
          event.type === 'prompt-response-status',
      );
  }

  sendInput(
    sessionId: SessionId,
    input: AgentInput,
    prepared?: PersistedTurnIntent,
    adapterInput?: AgentInput,
  ): Effect.Effect<void, unknown> {
    return Effect.suspend<void, unknown, never>(() => {
      const session = this.requireSession(sessionId);
      return session.run(
        Effect.suspend(() => this.inputs.send(sessionId, session, input, prepared, adapterInput)),
      );
    });
  }

  stop(sessionId: SessionId): Effect.Effect<void, OperationError> {
    return Effect.suspend(() =>
      this.teardown(sessionId, this.requireSession(sessionId), 'session.stop'),
    );
  }

  stopForReplacement(sessionId: SessionId): Effect.Effect<void, EngineFailure> {
    return Effect.suspend<void, EngineFailure, never>(() => {
      const session = this.sessions.get(sessionId);
      if (!session) return Effect.void;
      return this.teardown(sessionId, session, 'history.rewrite', false);
    });
  }

  delete(sessionId: SessionId): Effect.Effect<void, EngineFailure> {
    const { deleting, resources } = this;
    return Effect.gen({ self: this }, function* () {
      deleting.add(sessionId);
      const session = this.sessions.get(sessionId);
      if (session) {
        yield* this.teardown(sessionId, session, 'session.delete');
      }
      yield* resources.deleteSession(sessionId);
      yield* this.turns.deleteSession(sessionId);
      yield* this.records.delete(sessionId);
      this.journals.drop(sessionId);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          deleting.delete(sessionId);
        }),
      ),
    );
  }

  stopIfLive(sessionId: SessionId): Effect.Effect<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Effect.void;
    return this.teardown(sessionId, session, 'session.stop').pipe(Effect.catch(() => Effect.void));
  }

  makeUnattended(sessionId: SessionId): Effect.Effect<void> {
    const session = this.get(sessionId);
    if (!session) return Effect.void;
    return session.run(
      Effect.tryPromise({
        try: () =>
          session.adapter.send({
            type: 'set-approval-policy',
            policyId: 'bypassPermissions',
          }),
        catch: (e) => e,
      }).pipe(
        // Adapters without an approval-policy axis fail here; a later ask fails the unattended run.
        Effect.catch(() => Effect.void),
      ),
    );
  }

  prompt(
    sessionId: SessionId,
    text: string,
    opts?: { timeoutMs?: number },
  ): Effect.Effect<TurnResult, unknown> {
    return Effect.suspend<TurnResult, unknown, never>(() => {
      const session = this.requireSession(sessionId);
      if (session.turnInputActive) {
        return Effect.fail(
          new RequestError({ code: 'conflict', message: `Session is busy: ${sessionId}` }),
        );
      }
      session.turnInputActive = true;
      const content: ContentBlock[] = [{ type: 'text', text }];
      const { ingest, records, turns } = this;
      return session.run(
        Effect.gen({ self: this }, function* () {
          if (yield* turns.hasOpenOperation(sessionId)) {
            return yield* Effect.fail(
              new RequestError({ code: 'busy', message: `Session is busy: ${sessionId}` }),
            );
          }
          const intent = yield* turns.persistIntent({
            sessionId,
            operationId: mintOperationId(),
            runId: session.runId,
            parentTurnId: records.get(sessionId)?.activeLeafTurnId ?? null,
            input: { type: 'prompt', blocks: yield* ingest.promptBlocks(content) },
          });
          const result = yield* Effect.sync(() => {
            this.events.broadcast(
              sessionId,
              session,
              session.trackPrompt(
                userRowMessageId(intent.turn.turnId),
                content,
                intent.turn.turnId,
              ),
            );
            records.setTitleFromContent(sessionId, content);
          }).pipe(
            Effect.andThen(
              watchTurn(session.adapter, () => session.adapter.send({ type: 'prompt', content }), {
                ...opts,
                onDispatchAccepted: turns.commitRunning(intent),
              }),
            ),
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? turns
                    .resolveFailed(intent, {
                      code: 'operation_failed',
                      message: 'Automation prompt failed',
                    })
                    .pipe(
                      Effect.catch((error) =>
                        Effect.logError(
                          'Failed to record the rejected automation turn',
                          { sessionId },
                          error.cause,
                        ),
                      ),
                    )
                : Effect.void,
            ),
          );
          turns.settleStop(sessionId, session.runId, result.stopReason);
          if (session.status !== 'running') session.turnInputActive = false;
          return result;
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.sync(() => {
                  // A failed or interrupted dispatch can exit before a lifecycle event releases it.
                  if (session.status !== 'running') session.turnInputActive = false;
                })
              : Effect.void,
          ),
        ),
      );
    });
  }

  /** Bind a record to a live adapter serving `runId` — the run the caller just recorded. */
  startLive(
    replyTo: string | undefined,
    record: SessionRecord,
    runId: RunId,
    startAdapter: (adapter: AgentAdapter) => Effect.Effect<void, EngineFailure>,
    mcpWarnings: readonly McpWarning[] = [],
    options: {
      initialInput?: AgentInput;
      /** Turn intent already persisted for `initialInput`; its dispatch commits or fails it. */
      preparedTurn?: PersistedTurnIntent;
      registerRecord?: boolean;
      rewindMessageId?: MessageId;
    } = {},
  ): Effect.Effect<void, EngineFailure> {
    const {
      deleting,
      events,
      factory,
      inputs,
      records,
      runtimes,
      scope: parentScope,
      sessions,
      transport,
      turns,
    } = this;
    const { browserTools } = this;
    const discardFailedStart = (session: LiveSession): Effect.Effect<void> =>
      this.discardFailedStart(record.sessionId, session);
    const { initialInput, preparedTurn, registerRecord = true, rewindMessageId } = options;
    return observeOperation(
      Effect.gen(function* () {
        const sessionId = record.sessionId;
        if (deleting.has(sessionId)) {
          return yield* Effect.fail(
            new RequestError({ code: 'not_found', message: `Unknown session: ${sessionId}` }),
          );
        }
        const adapter = factory(record.kind);
        if (browserTools) adapter.attachBrowserTools?.(browserTools);
        const scope = yield* Scope.fork(parentScope);
        const closed = yield* Deferred.make<void, OperationError>();
        const session = new LiveSession(
          adapter,
          sessionId,
          runId,
          record.eventEpoch,
          scope,
          closed,
        );
        const startupEvents: AgentEvent[] = [];
        let bufferEvents = rewindMessageId !== undefined;
        session.listen(
          (event) => {
            if (bufferEvents) startupEvents.push(event);
            else events.handle(sessionId, session, event);
          },
          // Checkpoints never reach the wire, so the rewind buffer above does not apply.
          (checkpoint) => turns.bindLiveCheckpoint(sessionId, session.runId, checkpoint),
        );
        if (sessions.has(sessionId)) {
          session.stopListening();
          yield* Scope.close(scope, Exit.interrupt());
          return yield* Effect.fail(
            new RequestError({
              code: 'conflict',
              message: `Session is already running: ${sessionId}`,
            }),
          );
        }
        sessions.set(sessionId, session);
        yield* recordLiveSessions(sessions.size);
        if (registerRecord) records.register(record);
        // A start can land before the boot probe settles. Register first so delete can tear it down,
        // then wait and re-check identity before and after adapter startup to prevent resurrection.
        const startAdapterSession = Effect.gen(function* () {
          yield* runtimes.awaitReady();
          if (sessions.get(sessionId) !== session) return yield* Effect.interrupt;
          yield* startAdapter(adapter);
          if (sessions.get(sessionId) !== session) return yield* Effect.interrupt;
        });
        // Exit-based, not tapError: an interrupted start (submit timeout, teardown racing the
        // launch) must also unregister the session, or it stays a zombie in `'starting'` whose
        // next submit would 'continue' into an adapter that never started.
        yield* session
          .run(startAdapterSession)
          .pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? discardFailedStart(session).pipe(
                    Effect.catch((error) =>
                      Effect.logError('Failed to discard session record', error),
                    ),
                  )
                : Effect.void,
            ),
          );
        if (rewindMessageId !== undefined) {
          events.broadcast(sessionId, session, [
            { type: 'conversation-rewind', messageId: rewindMessageId },
          ]);
          bufferEvents = false;
          for (let i = 0, len = startupEvents.length; i < len; i++) {
            const event = startupEvents[i];
            events.handle(sessionId, session, event);
          }
        }
        if (initialInput !== undefined) {
          yield* session
            .run(Effect.suspend(() => inputs.send(sessionId, session, initialInput, preparedTurn)))
            .pipe(
              Effect.mapError((cause) =>
                toOperationFailure(cause, {
                  subsystem: 'agent',
                  operation: 'history.rewrite.input',
                  publicMessage: 'Agent input was rejected',
                }),
              ),
            );
        }
        if (sessions.get(sessionId) !== session) return yield* Effect.interrupt;
        if (replyTo !== undefined) {
          transport.send(
            createWireMessage({
              kind: 'session.started',
              replyTo,
              sessionId,
              ...(mcpWarnings.length > 0 && { mcpWarnings: [...mcpWarnings] }),
            }),
          );
        }
      }),
      {
        span: 'Session.start',
        subsystem: 'session',
        attributes: { sessionId: record.sessionId },
        metricAttributes: { operation: 'start' },
      },
    );
  }

  startAdapter(adapter: AgentAdapter, options: Parameters<AgentAdapter['start']>[0]) {
    return Effect.tryPromise({
      try: () => adapter.start(options),
      catch: (cause) =>
        new OperationError({
          subsystem: 'agent',
          operation: 'session.start',
          publicMessage: 'Agent failed to start',
          cause,
        }),
    });
  }

  shutdown(): Effect.Effect<void> {
    return Effect.forEach(
      Array.from(this.sessions),
      ([sessionId, session]) =>
        this.teardown(sessionId, session, 'session.shutdown').pipe(
          Effect.catchCause((cause) =>
            Effect.logError(
              'Failed to stop session during shutdown',
              { sessionId },
              Cause.squash(cause),
            ),
          ),
        ),
      { concurrency: 'unbounded', discard: true },
    ).pipe(Effect.ensuring(Effect.sync(() => this.sessions.clear())));
  }

  private teardown(
    sessionId: SessionId,
    session: LiveSession,
    operation: string,
    releaseSession = true,
  ): Effect.Effect<void, OperationError> {
    return observeOperation(
      Effect.suspend(() => {
        if (!session.beginClose()) return Deferred.await(session.closed);
        return Scope.close(session.scope, Exit.interrupt()).pipe(
          Effect.andThen(
            Effect.sync(() => {
              this.events.broadcast(sessionId, session, session.closeInteractions());
              session.stopListening();
            }),
          ),
          Effect.andThen(stopAdapter(session, operation)),
          Effect.ensuring(
            Effect.suspend(() => {
              if (!this.remove(sessionId, session)) return Effect.void;
              this.onRunEnded?.(sessionId, session.runId);
              if (releaseSession) this.onStopped(sessionId);
              // Teardown mid-turn kills the turn without a stop frame; settle it here.
              this.turns.settleStatus(sessionId, session.runId, 'stopped');
              this.records.sealRun(sessionId, session.runId);
              // The live tail dies with the live session (readers see the epoch-jump gap), so
              // journal memory stays bounded by the number of concurrent live adapters.
              this.journals.drop(sessionId);
              return recordLiveSessions(this.sessions.size);
            }),
          ),
          Effect.onExit((exit) => Deferred.done(session.closed, exit).pipe(Effect.asVoid)),
        );
      }),
      {
        span: 'Session.stop',
        subsystem: 'session',
        attributes: { sessionId, operation },
        metricAttributes: { operation },
      },
    );
  }

  private discardFailedStart(sessionId: SessionId, session: LiveSession): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (!session.beginClose()) {
        return Deferred.await(session.closed).pipe(Effect.exit, Effect.asVoid);
      }
      return Scope.close(session.scope, Exit.void).pipe(
        Effect.andThen(
          Effect.sync(() => {
            session.stopListening();
            this.records.sealRun(sessionId, session.runId);
          }),
        ),
        Effect.andThen(stopBestEffort(session.adapter)),
        Effect.ensuring(
          Effect.suspend(() => {
            if (!this.remove(sessionId, session)) return Effect.void;
            this.onRunEnded?.(sessionId, session.runId);
            // Release what a partial start may have reserved — notably the simulator MCP endpoint
            // token minted while resolving start options. Normal teardown does this via `onStopped`;
            // a discarded failed start must too, or that token leaks until daemon shutdown.
            this.onStopped(sessionId);
            this.journals.drop(sessionId);
            return recordLiveSessions(this.sessions.size);
          }),
        ),
        Effect.onExit((exit) => Deferred.done(session.closed, exit).pipe(Effect.asVoid)),
      );
    });
  }

  private requireSession(sessionId: SessionId): LiveSession {
    const session = this.sessions.get(sessionId);
    // eslint-disable-next-line sukka/prefer-nullthrow -- The wire boundary requires a typed, safely presentable error instead of nullthrow's TypeError.
    if (!session) {
      throw new RequestError({ code: 'not_found', message: `Unknown session: ${sessionId}` });
    }
    return session;
  }
}

function stopAdapter(session: LiveSession, operation: string): Effect.Effect<void, OperationError> {
  return Effect.tryPromise({
    try: () => session.adapter.stop(),
    catch: (cause) =>
      new OperationError({
        subsystem: 'agent',
        operation,
        publicMessage: 'Agent failed to stop',
        cause,
      }),
  });
}

function stopBestEffort(adapter: AgentAdapter): Effect.Effect<void> {
  return Effect.tryPromise({ try: () => adapter.stop(), catch: (e) => e }).pipe(
    Effect.catch(() => Effect.void),
  );
}
