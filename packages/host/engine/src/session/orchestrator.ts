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
import { noop } from 'foxts/noop';
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

  async sendInput(sessionId: SessionId, input: AgentInput): Promise<void> {
    const session = this.requireSession(sessionId);
    await this.inputs.send(sessionId, session, input);
  }

  async stop(sessionId: SessionId): Promise<void> {
    const session = this.requireSession(sessionId);
    this.events.broadcast(sessionId, session.closeInteractions());
    session.stopListening();
    try {
      await session.adapter.stop();
    } catch (error) {
      throw new OperationError({
        subsystem: 'agent',
        operation: 'session.stop',
        publicMessage: 'Agent failed to stop',
        cause: error,
      });
    } finally {
      if (this.remove(sessionId, session)) {
        this.onStopped(sessionId);
        this.records.sealCurrentRun(sessionId);
      }
    }
  }

  async delete(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.events.broadcast(sessionId, session.closeInteractions());
      session.stopListening();
      try {
        await session.adapter.stop();
      } catch (error) {
        this.records.sealCurrentRun(sessionId);
        throw new OperationError({
          subsystem: 'agent',
          operation: 'session.delete',
          publicMessage: 'Agent failed to stop',
          cause: error,
        });
      } finally {
        if (this.remove(sessionId, session)) this.onStopped(sessionId);
      }
    }
    try {
      await this.records.delete(sessionId);
    } catch (error) {
      if (session) this.records.sealCurrentRun(sessionId);
      throw error;
    }
  }

  async stopIfLive(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.stopListening();
    await session.adapter.stop().catch(noop);
    if (this.remove(sessionId, session)) {
      this.onStopped(sessionId);
      this.records.sealCurrentRun(sessionId);
    }
  }

  async makeUnattended(sessionId: SessionId): Promise<void> {
    const session = this.get(sessionId);
    if (!session) return;
    try {
      await session.adapter.send({
        type: 'set-approval-policy',
        policyId: 'bypassPermissions',
      });
    } catch {
      // Adapters without an approval-policy axis fail here; a later ask fails the unattended run.
    }
  }

  prompt(sessionId: SessionId, text: string, opts?: { timeoutMs?: number }): Promise<TurnResult> {
    const session = this.requireSession(sessionId);
    if (session.turnInputActive) {
      throw new RequestError({ code: 'conflict', message: `Session is busy: ${sessionId}` });
    }
    session.turnInputActive = true;
    const content: ContentBlock[] = [{ type: 'text', text }];
    this.events.broadcast(sessionId, [{ type: 'user-message', content }]);
    this.records.setTitleFromContent(sessionId, content);
    return watchTurn(
      session.adapter,
      () => session.adapter.send({ type: 'prompt', content }),
      opts,
    ).catch((error: unknown) => {
      // A fatal dispatch/ask can fail before a lifecycle event releases the turn gate.
      if (session.status !== 'running') session.turnInputActive = false;
      throw error;
    });
  }

  /** Bind a record to a live adapter. The record's current run must already be last in `runs`. */
  async startLive(
    replyTo: string | undefined,
    record: SessionRecord,
    startAdapter: (adapter: AgentAdapter) => Promise<void>,
  ): Promise<void> {
    const sessionId = record.sessionId;
    const adapter = this.factory(record.kind);
    const session = new LiveSession(adapter, sessionId);
    session.listen((event) => this.events.handle(sessionId, session, event));
    this.sessions.set(sessionId, session);
    this.records.register(record);
    // A start can land before the boot probe settles. Register first so delete can tear it down,
    // then wait and re-check identity before and after adapter startup to prevent resurrection.
    await this.runtimes.awaitReady();
    if (this.sessions.get(sessionId) !== session) {
      await adapter.stop().catch(noop);
      throw new RequestError({
        code: 'cancelled',
        message: `Session was closed while starting: ${sessionId}`,
      });
    }
    try {
      await startAdapter(adapter);
    } catch (error) {
      session.stopListening();
      if (this.remove(sessionId, session)) this.records.sealCurrentRun(sessionId);
      await adapter.stop().catch(noop);
      throw new OperationError({
        subsystem: 'agent',
        operation: 'session.start',
        publicMessage: 'Agent failed to start',
        cause: error,
      });
    }
    if (this.sessions.get(sessionId) !== session) {
      await adapter.stop().catch(noop);
      throw new RequestError({
        code: 'cancelled',
        message: `Session was closed while starting: ${sessionId}`,
      });
    }
    if (replyTo !== undefined) {
      this.transport.send(createWireMessage({ kind: 'session.started', replyTo, sessionId }));
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values(), async (session) => {
        session.stopListening();
        await session.adapter.stop();
      }),
    );
    this.sessions.clear();
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
