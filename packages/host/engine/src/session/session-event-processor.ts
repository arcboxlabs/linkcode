import { AUTH_FAILED_ERROR_CODE } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  SessionId,
  SessionNotificationReason,
  ToolKind,
  TurnId,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { AgentRuntimeService } from '../agent/runtime-service';
import type { ConversationLiveJournals } from '../conversation/live-journal';
import type { ConversationTurnService } from '../conversation/turn-service';
import type { ResourceService } from '../resource/service';
import type { LiveSession } from './live-session';
import type { SessionRecordRegistry } from './session-record-registry';

const SOURCE_TOOL_KINDS = new Set<ToolKind>(['fetch', 'read', 'search']);

/** Events describing the SESSION rather than a turn — status and catalogs. A replaced adapter's
 * stragglers of these kinds must not paint the session with a dead run's state; turn-scoped
 * events keep their old attribution and pass through. */
const SESSION_SCOPED_EVENT_TYPES = new Set<AgentEvent['type']>([
  'status',
  'approval-policy-update',
  'model-update',
  'effort-update',
  'available-commands-update',
  'available-models-update',
  'capabilities-update',
]);

/** Applies adapter events to live state, durable records, and wire projections. */
export class SessionEventProcessor {
  constructor(
    private readonly transport: Transport,
    private readonly records: SessionRecordRegistry,
    private readonly runtimes: AgentRuntimeService,
    private readonly reportFailure: (effect: Effect.Effect<void>) => void,
    private readonly resources: ResourceService,
    private readonly turns: ConversationTurnService,
    private readonly journals: ConversationLiveJournals,
  ) {}

  broadcast(sessionId: SessionId, session: LiveSession, events: Iterable<AgentEvent>): void {
    const turnId = this.turns.runningTurnId(sessionId, session.runId);
    for (const event of events) this.send(sessionId, session, event, turnId);
  }

  /** The one stamped exit: every `agent.event` frame mints its `(epoch, seq)` position here and
   * lands in the session's live journal, so the wire stream and the journal never diverge. */
  private send(
    sessionId: SessionId,
    session: LiveSession,
    event: AgentEvent,
    turnId: TurnId | undefined,
  ): void {
    const { epoch, runId } = session;
    const seq = session.nextSeq();
    this.journals.open(sessionId).append({ epoch, seq, runId, turnId, ts: Date.now(), event });
    this.transport.send(
      createWireMessage({ kind: 'agent.event', sessionId, runId, turnId, epoch, seq, event }),
    );
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

  rejectInput(sessionId: SessionId, session: LiveSession, message: string): void {
    this.broadcast(sessionId, session, [
      { type: 'error', message, code: 'input_rejected', recoverable: true },
    ]);
  }

  handle(sessionId: SessionId, session: LiveSession, event: AgentEvent): void {
    // Adapter callbacks are synchronous; contain failures to this session instead of throwing into
    // the SDK operation that emitted the event.
    try {
      if (
        SESSION_SCOPED_EVENT_TYPES.has(event.type) &&
        !this.records.isCurrentRun(sessionId, session.runId)
      ) {
        return;
      }
      // `running` promotes the dispatching turn first so this frame already carries it; captured
      // before the settle below so a turn-ending event still carries its turn.
      if (event.type === 'status' && event.status === 'running') {
        this.turns.noteRunning(sessionId, session.runId);
      }
      const turnId = this.turns.runningTurnId(sessionId, session.runId);
      const derived = session.apply(event);
      for (let i = 0, len = derived.length; i < len; i++) {
        this.send(sessionId, session, derived[i], turnId);
      }
      this.registerResources(sessionId, event);
      switch (event.type) {
        case 'status':
          if (event.status === 'stopped') this.records.sealRun(sessionId, session.runId);
          if (event.status === 'idle' || event.status === 'stopped') {
            this.turns.settleStatus(sessionId, session.runId, event.status);
          }
          break;
        case 'stop':
          this.turns.settleStop(sessionId, session.runId, event.stopReason);
          break;
        case 'session-ref':
          this.records.bindHistoryId(sessionId, session.runId, event.historyId);
          break;
        case 'title-update':
          this.records.setProviderTitle(sessionId, event.title);
          break;
        case 'error':
          if (event.code === AUTH_FAILED_ERROR_CODE) this.runtimes.refresh();
          this.turns.noteError(sessionId, session.runId);
          break;
        default:
          break;
      }
      this.send(sessionId, session, event, turnId);
      this.notify(sessionId, event);
    } catch (error) {
      this.reportFailure(Effect.logError('Failed to process agent event', { sessionId }, error));
    }
  }

  private notify(sessionId: SessionId, event: AgentEvent): void {
    const reason = notificationReason(event);
    const record = this.records.get(sessionId);
    // A provisional record (a fork child mid-saga) is in no client's list yet.
    if (!reason || !record || this.records.isProvisional(sessionId)) return;
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
