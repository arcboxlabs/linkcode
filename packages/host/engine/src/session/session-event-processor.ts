import { AUTH_FAILED_ERROR_CODE } from '@linkcode/agent-adapter';
import type { AgentEvent, SessionId, SessionNotificationReason, ToolKind } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { AgentRuntimeService } from '../agent/runtime-service';
import type { ResourceService } from '../resource/service';
import type { LiveSession } from './live-session';
import type { SessionRecordRegistry } from './session-record-registry';

const SOURCE_TOOL_KINDS = new Set<ToolKind>(['fetch', 'read', 'search']);

/** Applies adapter events to live state, durable records, and wire projections. */
export class SessionEventProcessor {
  constructor(
    private readonly transport: Transport,
    private readonly records: SessionRecordRegistry,
    private readonly runtimes: AgentRuntimeService,
    private readonly reportFailure: (effect: Effect.Effect<void>) => void,
    private readonly resources: ResourceService,
  ) {}

  broadcast(sessionId: SessionId, events: Iterable<AgentEvent>): void {
    for (const event of events) {
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    }
  }

  private registerResources(sessionId: SessionId, event: AgentEvent): void {
    const links =
      event.type === 'agent-message'
        ? (event.content ?? [])
        : event.type === 'agent-message-chunk'
          ? [event.content]
          : [];
    for (let i = 0, len = links.length; i < len; i++) {
      const block = links[i];
      if (block.type === 'resource_link') {
        this.registerResource(sessionId, 'output', block.uri, block.name, block.mimeType);
      }
    }
    if (event.type !== 'tool-call' || event.toolCall.status !== 'completed') return;
    for (let i = 0, len = event.toolCall.content.length; i < len; i++) {
      const item = event.toolCall.content[i];
      if (item.type === 'diff' && item.change === 'add') {
        this.registerResource(sessionId, 'output', item.path);
      }
      if (item.type === 'content' && item.content.type === 'resource_link') {
        this.registerResource(
          sessionId,
          SOURCE_TOOL_KINDS.has(event.toolCall.kind) ? 'source' : 'output',
          item.content.uri,
          item.content.name,
          item.content.mimeType,
        );
      }
    }
  }

  private registerResource(
    sessionId: SessionId,
    direction: 'source' | 'output',
    locator: string,
    name?: string,
    mimeType?: string,
  ): void {
    const registration =
      direction === 'source'
        ? this.resources.registerSource(sessionId, locator, name, mimeType)
        : this.resources.registerOutput(sessionId, locator, name, mimeType);
    this.reportFailure(
      registration.pipe(
        Effect.catch((error) =>
          Effect.logError(
            'Failed to register session resource',
            { sessionId, direction, locator, operation: error.operation },
            error.cause,
          ),
        ),
      ),
    );
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
      this.registerResources(sessionId, event);
      switch (event.type) {
        case 'status':
          if (event.status === 'stopped') this.records.sealCurrentRun(sessionId);
          break;
        case 'session-ref':
          this.records.bindHistoryId(sessionId, event.historyId);
          break;
        case 'title-update':
          this.records.setProviderTitle(sessionId, event.title);
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
      return {
        type: 'awaiting-approval',
        toolTitle: event.title ?? event.toolCall?.title ?? event.requestId,
      };
    case 'question-request':
      return { type: 'awaiting-approval', toolTitle: event.toolCall.title };
    case 'error':
      return { type: 'error', message: event.message };
    default:
      return undefined;
  }
}
