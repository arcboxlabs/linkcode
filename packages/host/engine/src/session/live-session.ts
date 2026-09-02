import { createHash } from 'node:crypto';
import type { AgentAdapter, HistoryCheckpoint } from '@linkcode/agent-adapter';
import { contentToText } from '@linkcode/agent-adapter';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentEvent,
  AgentHistoryId,
  AgentModelOption,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  MessageId,
  RunId,
  SessionId,
  SessionInfo,
  TurnId,
} from '@linkcode/schema';
import { TurnIdSchema } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import type { Deferred, Scope } from 'effect';
import { Effect, Fiber } from 'effect';
import { noop } from 'foxts/noop';
import type { OperationError } from '../failure';
import { InteractiveRequests } from './interactive-requests';

const LIVE_BRANCH_CURSOR_TYPE = 'linkcode-live-branch';

export type LiveBranchCursorParseResult =
  | { readonly type: 'provider' }
  | { readonly type: 'invalid-live' }
  | { readonly type: 'live'; readonly historyId: AgentHistoryId; readonly turnId: TurnId };

interface LivePrompt {
  readonly messageId: MessageId;
  readonly content: ContentBlock[];
  readonly turnId: TurnId;
}

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
  private historyId: AgentHistoryId | undefined;
  private readonly livePrompts: LivePrompt[] = [];
  private seq = 0;

  constructor(
    readonly adapter: AgentAdapter,
    sessionId: SessionId,
    /** The `SessionRun` this adapter serves — run bookkeeping addresses runs by this id. */
    readonly runId: RunId,
    /** The session's event epoch captured at launch: a replaced adapter's stragglers keep minting
     * under their own epoch, so they always compare below the replacement's positions. */
    readonly epoch: number,
    readonly scope: Scope.Closeable,
    readonly closed: Deferred.Deferred<void, OperationError>,
  ) {
    this.interactions = new InteractiveRequests(sessionId);
    this.capabilities = adapter.capabilities;
  }

  /** Mint the next event-plane position; monotone within this adapter's epoch. */
  nextSeq(): number {
    return ++this.seq;
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

  listen(
    listener: (event: AgentEvent) => void,
    onCheckpoint: (checkpoint: HistoryCheckpoint) => void,
  ): void {
    const unsubscribeEvents = this.adapter.onEvent(listener);
    const unsubscribeCheckpoints = this.adapter.onCheckpoint?.(onCheckpoint) ?? noop;
    this.unsubscribe = () => {
      unsubscribeEvents();
      unsubscribeCheckpoints();
    };
  }

  stopListening(): void {
    this.unsubscribe();
  }

  /** Echo a live prompt; its branch cursor names the persisted turn, so `history.branch` resolves
   * the cut through that turn's checkpoints. Without a history yet, the cursor rides the session-ref
   * re-echo instead (≤v79 clients expect the cursor to arrive once the history is known). */
  trackPrompt(messageId: MessageId, content: ContentBlock[], turnId: TurnId): AgentEvent[] {
    const prompt = { messageId, content, turnId };
    this.livePrompts.push(prompt);
    if (this.historyId === undefined) {
      return [{ type: 'user-message', messageId, content }];
    }
    return [this.livePromptEvent(prompt, this.historyId)];
  }

  untrackPrompt(messageId: MessageId): void {
    const index = this.livePrompts.findIndex((prompt) => prompt.messageId === messageId);
    if (index >= 0) this.livePrompts.splice(index, 1);
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
      case 'permission-resolved':
      case 'question-resolved':
        this.interactions.resolveFromAdapter(event);
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
      case 'session-ref':
        if (this.historyId === event.historyId) break;
        this.historyId = event.historyId;
        return this.livePromptEvents();
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

  private livePromptEvents(): AgentEvent[] {
    const historyId = this.historyId;
    if (historyId === undefined) return [];
    return this.livePrompts.map((prompt) => this.livePromptEvent(prompt, historyId));
  }

  private livePromptEvent(prompt: LivePrompt, historyId: AgentHistoryId): AgentEvent {
    return {
      type: 'user-message',
      messageId: prompt.messageId,
      content: prompt.content,
      branchCursor: encodeLiveBranchCursor(historyId, prompt.turnId),
    };
  }
}

export function decodeLiveBranchCursor(cursor: string): LiveBranchCursorParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    return { type: 'provider' };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    parsed.type !== LIVE_BRANCH_CURSOR_TYPE
  ) {
    return { type: 'provider' };
  }
  if (!('historyId' in parsed) || typeof parsed.historyId !== 'string' || !('turnId' in parsed)) {
    return { type: 'invalid-live' };
  }
  const turnId = TurnIdSchema.safeParse(parsed.turnId);
  if (!turnId.success) return { type: 'invalid-live' };
  return { type: 'live', historyId: parsed.historyId as AgentHistoryId, turnId: turnId.data };
}

export function promptContentFingerprint(content: ContentBlock[]): string {
  return createHash('sha256').update(contentToText(content)).digest('base64url');
}

export function encodeLiveBranchCursor(historyId: AgentHistoryId, turnId: TurnId): string {
  return JSON.stringify({ type: LIVE_BRANCH_CURSOR_TYPE, historyId, turnId });
}
