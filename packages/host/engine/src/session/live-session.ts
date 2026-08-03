import { createHash } from 'node:crypto';
import type { AgentAdapter } from '@linkcode/agent-adapter';
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
  SessionId,
  SessionInfo,
} from '@linkcode/schema';
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
  | {
      readonly type: 'live';
      readonly historyId: AgentHistoryId;
      readonly offsetFromEnd: number;
      readonly contentFingerprint: string;
    };

interface LivePrompt {
  readonly messageId: MessageId;
  readonly content: ContentBlock[];
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

  trackPrompt(messageId: MessageId, content: ContentBlock[]): AgentEvent[] {
    this.livePrompts.push({ messageId, content });
    if (this.historyId === undefined) {
      return [{ type: 'user-message', messageId, content }];
    }
    return this.livePromptEvents(promptContentFingerprint(content));
  }

  untrackPrompt(messageId: MessageId): AgentEvent[] {
    const index = this.livePrompts.findIndex((prompt) => prompt.messageId === messageId);
    if (index < 0) return [];
    const contentFingerprint = promptContentFingerprint(this.livePrompts[index].content);
    this.livePrompts.splice(index, 1);
    return this.historyId === undefined ? [] : this.livePromptEvents(contentFingerprint);
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

  private livePromptEvents(onlyFingerprint?: string): AgentEvent[] {
    const historyId = this.historyId;
    if (historyId === undefined) return [];
    const occurrenceByFingerprint = new Map<string, number>();
    return this.livePrompts
      .toReversed()
      .map((prompt) => {
        const contentFingerprint = promptContentFingerprint(prompt.content);
        const offsetFromEnd = occurrenceByFingerprint.get(contentFingerprint) ?? 0;
        occurrenceByFingerprint.set(contentFingerprint, offsetFromEnd + 1);
        return {
          type: 'user-message' as const,
          messageId: prompt.messageId,
          content: prompt.content,
          branchCursor: encodeLiveBranchCursor(historyId, offsetFromEnd, contentFingerprint),
        };
      })
      .reverse()
      .filter(
        (event) =>
          onlyFingerprint === undefined ||
          promptContentFingerprint(event.content) === onlyFingerprint,
      );
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
  if (
    !('historyId' in parsed) ||
    typeof parsed.historyId !== 'string' ||
    !('offsetFromEnd' in parsed) ||
    typeof parsed.offsetFromEnd !== 'number' ||
    !Number.isSafeInteger(parsed.offsetFromEnd) ||
    parsed.offsetFromEnd < 0 ||
    !('contentFingerprint' in parsed) ||
    typeof parsed.contentFingerprint !== 'string'
  ) {
    return { type: 'invalid-live' };
  }
  return {
    type: 'live',
    historyId: parsed.historyId as AgentHistoryId,
    offsetFromEnd: parsed.offsetFromEnd,
    contentFingerprint: parsed.contentFingerprint,
  };
}

export function promptContentFingerprint(content: ContentBlock[]): string {
  return createHash('sha256').update(contentToText(content)).digest('base64url');
}

function encodeLiveBranchCursor(
  historyId: AgentHistoryId,
  offsetFromEnd: number,
  contentFingerprint: string,
): string {
  return JSON.stringify({
    type: LIVE_BRANCH_CURSOR_TYPE,
    historyId,
    offsetFromEnd,
    contentFingerprint,
  });
}
