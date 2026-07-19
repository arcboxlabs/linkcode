import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { AUTH_FAILED_ERROR_CODE } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentInput,
  ContentBlock,
  SessionId,
  SessionInfo,
  SessionNotificationReason,
  SessionRecord,
} from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import type { AgentRuntimeService } from '../agent/runtime-service';
import type { TurnResult } from '../automation/turn-watcher';
import { watchTurn } from '../automation/turn-watcher';
import { assertAttachmentContentAllowed } from './attachment-guard';
import { LiveSession } from './live-session';
import type { SessionRecordRegistry } from './session-record-registry';

export class SessionOrchestrator {
  private readonly sessions = new Map<SessionId, LiveSession>();

  constructor(
    private readonly transport: Transport,
    private readonly factory: AdapterFactory,
    private readonly records: SessionRecordRegistry,
    private readonly runtimes: AgentRuntimeService,
    private readonly onStopped: (sessionId: SessionId) => void,
  ) {}

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
    if (session) this.broadcast(sessionId, session.replay());
  }

  async sendInput(sessionId: SessionId, input: AgentInput): Promise<void> {
    const session = nullthrow(this.sessions.get(sessionId), `Unknown session: ${sessionId}`);
    const startsTurn =
      input.type === 'prompt' || input.type === 'command' || input.type === 'shell-command';
    if (
      input.type === 'command' &&
      (!session.capabilities.slashCommands ||
        !session.availableCommands?.some((command) => agentCommandMatches(command, input.name)))
    ) {
      const error = new Error(`Unknown slash command: /${input.name}`);
      this.rejectInput(sessionId, error.message);
      throw error;
    }
    if (input.type === 'shell-command' && !session.capabilities.shellCommand) {
      const error = new Error('Shell commands are not supported by this session');
      this.rejectInput(sessionId, error.message);
      throw error;
    }
    if (startsTurn && session.turnInputActive) {
      const error = new Error(`Session is busy: ${sessionId}`);
      this.rejectInput(sessionId, error.message);
      throw error;
    }
    if (startsTurn) session.turnInputActive = true;
    // Echo before awaiting send: provider events can outrun the dispatch acknowledgement.
    if (input.type === 'prompt') {
      assertAttachmentContentAllowed(input.content);
      this.broadcast(sessionId, [{ type: 'user-message', content: input.content }]);
      this.records.setTitleFromContent(sessionId, input.content);
    } else if (input.type === 'command' || input.type === 'shell-command') {
      const text =
        input.type === 'command'
          ? `/${input.name}${input.arguments ? ` ${input.arguments}` : ''}`
          : `$ ${input.command}`;
      this.broadcast(sessionId, [{ type: 'user-message', content: [{ type: 'text', text }] }]);
    }
    const responseInput =
      input.type === 'permission-response' || input.type === 'question-response'
        ? input
        : undefined;
    const respondingAsk = responseInput
      ? session.interactions.beginResponse(responseInput)
      : undefined;
    if (responseInput && respondingAsk) {
      this.broadcast(sessionId, [
        {
          type: 'prompt-response-status',
          requestId: responseInput.requestId,
          status: 'responding',
        },
      ]);
    }
    try {
      await session.adapter.send(input);
    } catch (error) {
      if (responseInput && respondingAsk) {
        this.broadcast(
          sessionId,
          session.interactions.restoreResponse(responseInput.requestId, respondingAsk),
        );
      }
      if (startsTurn && session.status !== 'running') session.turnInputActive = false;
      if (startsTurn) {
        this.rejectInput(sessionId, extractErrorMessage(error) ?? 'Agent input was rejected');
      }
      throw error;
    }
    if (responseInput && respondingAsk) {
      const resolution = session.interactions.resolveResponse(responseInput, respondingAsk);
      if (resolution) this.broadcast(sessionId, [resolution]);
    }
    // Synchronous controls may not produce lifecycle events; only a running turn keeps the gate.
    if (startsTurn && session.status !== 'running') session.turnInputActive = false;
  }

  async stop(sessionId: SessionId): Promise<void> {
    const session = nullthrow(this.sessions.get(sessionId), `Unknown session: ${sessionId}`);
    this.broadcast(sessionId, session.closeInteractions());
    session.stopListening();
    try {
      await session.adapter.stop();
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
      this.broadcast(sessionId, session.closeInteractions());
      session.stopListening();
      try {
        await session.adapter.stop();
      } catch (error) {
        this.records.sealCurrentRun(sessionId);
        throw error;
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
    const session = nullthrow(this.get(sessionId), `Unknown session: ${sessionId}`);
    if (session.turnInputActive) throw new Error(`Session is busy: ${sessionId}`);
    session.turnInputActive = true;
    const content: ContentBlock[] = [{ type: 'text', text }];
    this.broadcast(sessionId, [{ type: 'user-message', content }]);
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

  private broadcast(sessionId: SessionId, events: Iterable<AgentEvent>): void {
    for (const event of events) {
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    }
  }

  private rejectInput(sessionId: SessionId, message: string): void {
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
