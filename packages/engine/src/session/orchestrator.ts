import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { AUTH_FAILED_ERROR_CODE } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  SessionId,
  SessionInfo,
  SessionNotificationReason,
  SessionRecord,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import type { AgentRuntimeService } from '../agent/runtime-service';
import { LiveSession } from './live-session';
import type { SessionRecordRegistry } from './session-record-registry';

export class SessionOrchestrator {
  private readonly sessions = new Map<SessionId, LiveSession>();

  constructor(
    private readonly transport: Transport,
    private readonly factory: AdapterFactory,
    private readonly records: SessionRecordRegistry,
    private readonly runtimes: AgentRuntimeService,
  ) {}

  get(sessionId: SessionId): LiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: SessionId): boolean {
    return this.sessions.has(sessionId);
  }

  remove(sessionId: SessionId, session: LiveSession): boolean {
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
    if (session) this.broadcast(sessionId, session.replay());
  }

  broadcast(sessionId: SessionId, events: Iterable<AgentEvent>): void {
    for (const event of events) {
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    }
  }

  rejectInput(sessionId: SessionId, message: string): void {
    this.transport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        event: { type: 'error', message, code: 'input_rejected', recoverable: true },
      }),
    );
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
    session.listen((event) => this.onAdapterEvent(sessionId, session, event));
    this.sessions.set(sessionId, session);
    this.records.register(record);
    // A start can land before the boot probe settles. Register first so delete can tear it down,
    // then wait and re-check identity before and after adapter startup to prevent resurrection.
    await this.runtimes.ready;
    if (this.sessions.get(sessionId) !== session) {
      await adapter.stop().catch(noop);
      throw new Error(`Session was closed while starting: ${sessionId}`);
    }
    try {
      await startAdapter(adapter);
    } catch (error) {
      session.stopListening();
      if (this.remove(sessionId, session)) this.records.sealCurrentRun(sessionId);
      await adapter.stop().catch(noop);
      throw error;
    }
    if (this.sessions.get(sessionId) !== session) {
      await adapter.stop().catch(noop);
      throw new Error(`Session was closed while starting: ${sessionId}`);
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

  private onAdapterEvent(sessionId: SessionId, session: LiveSession, event: AgentEvent): void {
    // Adapter callbacks are synchronous; contain failures to this session instead of throwing into
    // the SDK operation that emitted the event.
    try {
      this.broadcast(sessionId, session.apply(event));
      switch (event.type) {
        case 'status':
          if (event.status === 'stopped') this.records.sealCurrentRun(sessionId);
          break;
        case 'session-ref':
          this.records.bindHistoryId(sessionId, event.historyId);
          break;
        case 'error':
          if (event.code === AUTH_FAILED_ERROR_CODE) void this.runtimes.refresh();
          break;
        default:
          break;
      }
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
      this.notify(sessionId, event);
    } catch (error) {
      console.error(`Error handling adapter event for session ${sessionId}:`, error);
    }
  }

  private notify(sessionId: SessionId, event: AgentEvent): void {
    const reason = notificationReason(event);
    const record = this.records.get(sessionId);
    if (!reason || !record) return;
    this.transport.send(
      createWireMessage({
        kind: 'session.notification',
        notification: {
          sessionId,
          kind: record.kind,
          cwd: record.cwd,
          title: record.title,
          reason,
        },
      }),
    );
  }
}

function notificationReason(event: AgentEvent): SessionNotificationReason | undefined {
  switch (event.type) {
    case 'stop':
      return { type: 'turn-completed', stopReason: event.stopReason };
    case 'permission-request':
    case 'question-request':
      return { type: 'awaiting-approval', toolTitle: event.toolCall.title };
    case 'error':
      return { type: 'error', message: event.message };
    default:
      return undefined;
  }
}
