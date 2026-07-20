import type { AgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentEvent,
  AgentModelOption,
  ApprovalPolicyState,
  EffortLevel,
  SessionId,
  SessionInfo,
} from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import type { Deferred, Scope } from 'effect';
import { Effect, Fiber } from 'effect';
import { noop } from 'foxts/noop';
import type { OperationError } from '../failure';
import { InteractiveRequests } from './interactive-requests';

/** Mutable state derived from one live adapter's event stream. */
export class LiveSession {
  readonly interactions: InteractiveRequests;
  status: SessionInfo['status'] = 'starting';
  /** Adapters disagree on whether send() covers dispatch or a whole turn, so the host owns this gate. */
  turnInputActive = false;
  approvalPolicy?: ApprovalPolicyState;
  currentModel?: string;
  currentEffort?: EffortLevel;
  availableCommands?: AgentCommand[];
  availableModels?: AgentModelOption[];
  capabilities: AgentCapabilities;
  private unsubscribe: Unsubscribe = noop;
  private closing = false;

  constructor(
    readonly adapter: AgentAdapter,
    sessionId: SessionId,
    readonly scope: Scope.Closeable,
    readonly closed: Deferred.Deferred<void, OperationError>,
  ) {
    this.interactions = new InteractiveRequests(sessionId);
    this.capabilities = adapter.capabilities;
  }

  run<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.suspend(() =>
      this.closing
        ? Effect.interrupt
        : Effect.forkIn(effect, this.scope).pipe(
            Effect.flatMap((fiber) =>
              Fiber.join(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber))),
            ),
          ),
    );
  }

  beginClose(): boolean {
    if (this.closing) return false;
    this.closing = true;
    return true;
  }

  listen(listener: (event: AgentEvent) => void): void {
    this.unsubscribe = this.adapter.onEvent(listener);
  }

  stopListening(): void {
    this.unsubscribe();
  }

  /** Apply adapter-owned state before the original event is broadcast; returned resolutions must
   * be broadcast first so clients close stale prompt cards before folding the turn boundary. */
  apply(event: AgentEvent): AgentEvent[] {
    switch (event.type) {
      case 'status': {
        if (event.status === 'running' && this.status !== 'running') {
          this.interactions.beginTurn();
        }
        this.status = event.status;
        if (event.status === 'running') this.turnInputActive = true;
        if (event.status === 'idle' || event.status === 'stopped') {
          this.turnInputActive = false;
          return this.interactions.cancelOpen();
        }
        break;
      }
      case 'approval-policy-update':
        this.approvalPolicy = event.state;
        break;
      case 'permission-request':
      case 'question-request':
        this.interactions.open(event);
        break;
      case 'tool-call':
        if (event.toolCall.status === 'completed' || event.toolCall.status === 'failed') {
          return this.interactions.cancelOpen(event.toolCall.toolCallId);
        }
        break;
      case 'model-update':
        this.currentModel = event.model;
        break;
      case 'effort-update':
        this.currentEffort = event.effort;
        break;
      case 'available-commands-update':
        this.availableCommands = event.commands;
        break;
      case 'available-models-update':
        this.availableModels = event.models;
        break;
      case 'capabilities-update':
        this.capabilities = event.capabilities;
        break;
      default:
        break;
    }
    return [];
  }

  replay(): AgentEvent[] {
    const events: AgentEvent[] = [{ type: 'status', status: this.status }];
    if (this.approvalPolicy) {
      events.push({ type: 'approval-policy-update', state: this.approvalPolicy });
    }
    if (this.currentModel) events.push({ type: 'model-update', model: this.currentModel });
    if (this.currentEffort) events.push({ type: 'effort-update', effort: this.currentEffort });
    events.push({ type: 'capabilities-update', capabilities: this.capabilities });
    if (this.availableCommands) {
      events.push({ type: 'available-commands-update', commands: this.availableCommands });
    }
    if (this.availableModels) {
      events.push({ type: 'available-models-update', models: this.availableModels });
    }
    return events.concat(this.interactions.replay());
  }

  closeInteractions(): AgentEvent[] {
    const resolutions = this.interactions.close();
    if (!resolutions) return [];
    this.status = 'stopped';
    this.turnInputActive = false;
    return [...resolutions, { type: 'status', status: 'stopped' }];
  }
}
