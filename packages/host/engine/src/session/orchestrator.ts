import type { AdapterFactory, AgentAdapter, BrowserToolsetFactory } from '@linkcode/agent-adapter';
import { nextMessageId } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentInput,
  ContentBlock,
  McpWarning,
  MessageId,
  SessionId,
  SessionInfo,
  SessionRecord,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Cause, Deferred, Effect, Exit, Scope } from 'effect';
import type { AgentRuntimeService } from '../agent/runtime-service';
import type { TurnResult } from '../automation/turn-watcher';
import { watchTurn } from '../automation/turn-watcher';
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
    private readonly browserTools?: BrowserToolsetFactory,
  ) {
    this.events = new SessionEventProcessor(transport, records, runtimes, reportFailure, resources);
    this.inputs = new SessionInputDispatcher(records, this.events, resources);
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

  replay(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (session) this.events.broadcast(sessionId, session.replay());
  }

  sendInput(sessionId: SessionId, input: AgentInput): Effect.Effect<void, unknown> {
    return Effect.suspend<void, unknown, never>(() => {
      const session = this.requireSession(sessionId);
      return session.run(Effect.suspend(() => this.inputs.send(sessionId, session, input)));
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
      if (session.turnInputActive || (session.status !== 'idle' && session.status !== 'stopped')) {
        return Effect.fail(
          new RequestError({ code: 'conflict', message: `Session is busy: ${sessionId}` }),
        );
      }
      return this.teardown(sessionId, session, 'history.rewrite', false);
    });
  }

  delete(sessionId: SessionId): Effect.Effect<void, EngineFailure> {
    const { resources } = this;
    return Effect.gen({ self: this }, function* () {
      const session = this.sessions.get(sessionId);
      if (session) {
        yield* this.teardown(sessionId, session, 'session.delete');
      }
      yield* resources.deleteSession(sessionId);
      yield* this.records.delete(sessionId);
    });
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
      return session.run(
        Effect.sync(() => {
          this.events.broadcast(sessionId, [
            { type: 'user-message', messageId: nextMessageId(), content },
          ]);
          this.records.setTitleFromContent(sessionId, content);
        }).pipe(
          Effect.andThen(
            watchTurn(
              session.adapter,
              () => session.adapter.send({ type: 'prompt', content }),
              opts,
            ),
          ),
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

  /** Bind a record to a live adapter. The record's current run must already be last in `runs`. */
  startLive(
    replyTo: string | undefined,
    record: SessionRecord,
    startAdapter: (adapter: AgentAdapter) => Effect.Effect<void, EngineFailure>,
    mcpWarnings: readonly McpWarning[] = [],
    options: {
      initialInput?: AgentInput;
      registerRecord?: boolean;
      rewindMessageId?: MessageId;
    } = {},
  ): Effect.Effect<void, EngineFailure> {
    const {
      events,
      factory,
      inputs,
      records,
      runtimes,
      scope: parentScope,
      sessions,
      transport,
    } = this;
    const { browserTools } = this;
    const discardFailedStart = (session: LiveSession): Effect.Effect<void> =>
      this.discardFailedStart(record.sessionId, session);
    const { initialInput, registerRecord = true, rewindMessageId } = options;
    return observeOperation(
      Effect.gen(function* () {
        const sessionId = record.sessionId;
        const adapter = factory(record.kind);
        if (browserTools) adapter.attachBrowserTools?.(browserTools);
        const scope = yield* Scope.fork(parentScope);
        const closed = yield* Deferred.make<void, OperationError>();
        const session = new LiveSession(adapter, sessionId, scope, closed);
        const startupEvents: AgentEvent[] = [];
        let bufferEvents = rewindMessageId !== undefined;
        session.listen((event) => {
          if (bufferEvents) startupEvents.push(event);
          else events.handle(sessionId, session, event);
        });
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
        yield* session
          .run(startAdapterSession)
          .pipe(
            Effect.tapError(() =>
              discardFailedStart(session).pipe(
                Effect.catch((error) => Effect.logError('Failed to discard session record', error)),
              ),
            ),
          );
        if (rewindMessageId !== undefined) {
          events.broadcast(sessionId, [
            { type: 'conversation-rewind', messageId: rewindMessageId },
          ]);
          bufferEvents = false;
          for (const event of startupEvents) events.handle(sessionId, session, event);
        }
        if (initialInput !== undefined) {
          yield* session
            .run(Effect.suspend(() => inputs.send(sessionId, session, initialInput)))
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
              this.events.broadcast(sessionId, session.closeInteractions());
              session.stopListening();
            }),
          ),
          Effect.andThen(stopAdapter(session, operation)),
          Effect.ensuring(
            Effect.suspend(() => {
              if (!this.remove(sessionId, session)) return Effect.void;
              if (releaseSession) this.onStopped(sessionId);
              this.records.sealCurrentRun(sessionId);
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
            this.records.sealCurrentRun(sessionId);
          }),
        ),
        Effect.andThen(stopBestEffort(session.adapter)),
        Effect.ensuring(
          Effect.suspend(() => {
            if (!this.remove(sessionId, session)) return Effect.void;
            // Release what a partial start may have reserved — notably the simulator MCP endpoint
            // token minted while resolving start options. Normal teardown does this via `onStopped`;
            // a discarded failed start must too, or that token leaks until daemon shutdown.
            this.onStopped(sessionId);
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
