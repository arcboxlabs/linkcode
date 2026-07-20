import { AUTH_FAILED_ERROR_CODE } from '@linkcode/agent-adapter';
import type { AgentEvent, SessionId, SessionNotificationReason } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { AgentRuntimeService } from '../agent/runtime-service';
import type { LiveSession } from './live-session';
import type { SessionRecordRegistry } from './session-record-registry';

/** Applies adapter events to live state, durable records, and wire projections. */
export class SessionEventProcessor {
  constructor(
    private readonly transport: Transport,
    private readonly records: SessionRecordRegistry,
    private readonly runtimes: AgentRuntimeService,
    private readonly reportFailure: (effect: Effect.Effect<void>) => void,
  ) {}

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

  handle(sessionId: SessionId, session: LiveSession, event: AgentEvent): void {
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
          if (event.code === AUTH_FAILED_ERROR_CODE) this.runtimes.refresh();
          break;
        default:
          break;
      }
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
      this.notify(sessionId, event);
    } catch (error) {
      this.reportFailure(Effect.logError('Failed to process agent event', { sessionId }, error));
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
