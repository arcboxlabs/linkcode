import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentInput,
  ContentBlock,
  SessionId,
  SessionInfo,
  SessionRecord,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { AgentRuntimeService } from '../agent/runtime-service';
import type { TurnResult } from '../automation/turn-watcher';
import { watchTurn } from '../automation/turn-watcher';
import { OperationError, RequestError } from '../failure';
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
    private readonly onStopped: (sessionId: SessionId) => void,
  ) {
    this.events = new SessionEventProcessor(transport, records, runtimes);
    this.inputs = new SessionInputDispatcher(records, this.events);
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
    return this.records.list((sessionId) => this.sessions.get(sessionId)?.status);
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
    return Effect.suspend(() => this.inputs.send(sessionId, this.requireSession(sessionId), input));
  }

  stop(sessionId: SessionId): Effect.Effect<void, OperationError> {
    return Effect.suspend(() => {
      const session = this.requireSession(sessionId);
      this.events.broadcast(sessionId, session.closeInteractions());
      session.stopListening();
      return stopAdapter(session, 'session.stop').pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (this.remove(sessionId, session)) {
              this.onStopped(sessionId);
              this.records.sealCurrentRun(sessionId);
            }
          }),
        ),
      );
    });
  }

  delete(sessionId: SessionId): Effect.Effect<void, unknown> {
    const { events, records, sessions } = this;
    const remove = (session: LiveSession): boolean => this.remove(sessionId, session);
    const onStopped = (): void => this.onStopped(sessionId);
    return Effect.gen(function* () {
      const session = sessions.get(sessionId);
      if (session) {
        events.broadcast(sessionId, session.closeInteractions());
        session.stopListening();
        yield* stopAdapter(session, 'session.delete').pipe(
          Effect.tapError(() => Effect.sync(() => records.sealCurrentRun(sessionId))),
          Effect.ensuring(
            Effect.sync(() => {
              if (remove(session)) onStopped();
            }),
          ),
        );
      }
      yield* Effect.tryPromise({ try: () => records.delete(sessionId), catch: (e) => e }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            if (session) records.sealCurrentRun(sessionId);
          }),
        ),
      );
    });
  }

  stopIfLive(sessionId: SessionId): Effect.Effect<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Effect.void;
    session.stopListening();
    return Effect.tryPromise({ try: () => session.adapter.stop(), catch: (e) => e }).pipe(
      Effect.catch(() => Effect.void),
      Effect.andThen(
        Effect.sync(() => {
          if (this.remove(sessionId, session)) {
            this.onStopped(sessionId);
            this.records.sealCurrentRun(sessionId);
          }
        }),
      ),
    );
  }

  makeUnattended(sessionId: SessionId): Effect.Effect<void> {
    const session = this.get(sessionId);
    if (!session) return Effect.void;
    return Effect.tryPromise({
      try: () =>
        session.adapter.send({
          type: 'set-approval-policy',
          policyId: 'bypassPermissions',
        }),
      catch: (e) => e,
    }).pipe(
      // Adapters without an approval-policy axis fail here; a later ask fails the unattended run.
      Effect.catch(() => Effect.void),
    );
  }

  prompt(
    sessionId: SessionId,
    text: string,
    opts?: { timeoutMs?: number },
  ): Effect.Effect<TurnResult, unknown> {
    return Effect.suspend(() => {
      const session = this.requireSession(sessionId);
      if (session.turnInputActive) {
        return Effect.fail(
          new RequestError({ code: 'conflict', message: `Session is busy: ${sessionId}` }),
        );
      }
      session.turnInputActive = true;
      const content: ContentBlock[] = [{ type: 'text', text }];
      this.events.broadcast(sessionId, [{ type: 'user-message', content }]);
      this.records.setTitleFromContent(sessionId, content);
      return Effect.tryPromise({
        try: () =>
          watchTurn(session.adapter, () => session.adapter.send({ type: 'prompt', content }), opts),
        catch: (e) => e,
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            // A fatal dispatch/ask can fail before a lifecycle event releases the turn gate.
            if (session.status !== 'running') session.turnInputActive = false;
          }),
        ),
      );
    });
  }

  /** Bind a record to a live adapter. The record's current run must already be last in `runs`. */
  startLive(
    replyTo: string | undefined,
    record: SessionRecord,
    startAdapter: (adapter: AgentAdapter) => Promise<void>,
  ): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      const sessionId = record.sessionId;
      const adapter = this.factory(record.kind);
      const session = new LiveSession(adapter, sessionId);
      const { records, runtimes, sessions, transport } = this;
      const remove = (): boolean => this.remove(sessionId, session);
      session.listen((event) => this.events.handle(sessionId, session, event));
      sessions.set(sessionId, session);
      records.register(record);
      // A start can land before the boot probe settles. Register first so delete can tear it down,
      // then wait and re-check identity before and after adapter startup to prevent resurrection.
      return Effect.gen(function* () {
        yield* Effect.tryPromise({ try: () => runtimes.awaitReady(), catch: (e) => e });
        if (sessions.get(sessionId) !== session) {
          yield* stopBestEffort(adapter);
          return yield* Effect.fail(sessionClosed(sessionId));
        }
        yield* Effect.tryPromise({
          try: () => startAdapter(adapter),
          catch: (cause) =>
            new OperationError({
              subsystem: 'agent',
              operation: 'session.start',
              publicMessage: 'Agent failed to start',
              cause,
            }),
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              session.stopListening();
              if (remove()) records.sealCurrentRun(sessionId);
            }),
          ),
          Effect.tapError(() => stopBestEffort(adapter)),
        );
        if (sessions.get(sessionId) !== session) {
          yield* stopBestEffort(adapter);
          return yield* Effect.fail(sessionClosed(sessionId));
        }
        if (replyTo !== undefined) {
          transport.send(createWireMessage({ kind: 'session.started', replyTo, sessionId }));
        }
      });
    });
  }

  shutdown(): Effect.Effect<void, unknown> {
    return Effect.forEach(
      this.sessions.values(),
      (session) => {
        session.stopListening();
        return Effect.tryPromise({ try: () => session.adapter.stop(), catch: (e) => e });
      },
      { concurrency: 'unbounded', discard: true },
    ).pipe(Effect.ensuring(Effect.sync(() => this.sessions.clear())));
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

function sessionClosed(sessionId: SessionId): RequestError {
  return new RequestError({
    code: 'cancelled',
    message: `Session was closed while starting: ${sessionId}`,
  });
}
