import type {
  AgentEvent,
  ContentBlock,
  PermissionOption,
  Plan,
  SessionStatus,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
} from '@linkcode/schema';
import type { SequencedAgentEvent } from './client';

/**
 * Conversation view-model. The daemon streams a flat, append-only `AgentEvent[]`; the UI needs a
 * structured timeline (turn-grouped messages bucketed by messageId, tool calls as full snapshots, plan,
 * permissions) plus the session's live lifecycle state. `buildConversation` is a pure reducer over the
 * event list so it can be unit-tested without a transport (mirrors the adapter normalizer convention).
 */

export type ConversationTurnId = string | null;

/**
 * Fields every timeline item carries. `receivedAt` is the client receive time of the item's
 * latest event — TODO(wire): approximate and absent for history-seeded items; replace with an
 * authoritative event timestamp once the wire carries one.
 */
interface ConversationItemBase {
  id: string;
  turnId: ConversationTurnId;
  receivedAt?: number;
}

/** A single semantic item in the conversation timeline. */
export type ConversationItem =
  | (ConversationItemBase & {
      kind: 'message';
      role: 'user' | 'assistant';
      blocks: ContentBlock[];
      isStreaming: boolean;
    })
  | (ConversationItemBase & {
      kind: 'reasoning';
      blocks: ContentBlock[];
      isStreaming: boolean;
    })
  | (ConversationItemBase & { kind: 'tool'; toolCall: ToolCall })
  | (ConversationItemBase & { kind: 'plan'; plan: Plan })
  | (ConversationItemBase & {
      kind: 'approval';
      requestId: string;
      toolCall: ToolCallUpdate;
      options: PermissionOption[];
    })
  | (ConversationItemBase & {
      kind: 'error';
      message: string;
      code?: string;
      recoverable: boolean;
    });

export interface ConversationViewModel {
  /** Ordered timeline of everything the user should see. */
  items: ConversationItem[];
  /** Coarse session lifecycle, from the latest `status` event. */
  status: SessionStatus | null;
  /** Latest cumulative token usage. */
  usage: TokenUsage | null;
  /** Active session mode id (e.g. plan / accept-edits), from `current-mode-update`. */
  currentModeId: string | null;
  /** Why the last turn ended (if it did). */
  stopReason: StopReason | null;
  /**
   * requestIds of permission asks that are still open — i.e. their referenced tool call hasn't reached a
   * terminal status. The UI additionally hides ones the user already answered in this client.
   */
  pendingPermissionIds: string[];
}

export type Conversation = ConversationViewModel;

/** Append a content block to a message item, concatenating consecutive text blocks for smooth streaming. */
function appendBlock(blocks: ContentBlock[], block: ContentBlock): void {
  const last = blocks.at(-1);
  if (last?.type === 'text' && block.type === 'text') {
    blocks[blocks.length - 1] = {
      ...last,
      text: last.text + block.text,
      annotations: block.annotations ?? last.annotations,
    };
    return;
  }
  blocks.push(block);
}

/** An agent event optionally paired with its client receive time (see `SequencedAgentEvent`). */
export type StampedAgentEvent = AgentEvent & { receivedAt?: number };

/** Build a structured Conversation from the flat, append-only agent event stream. Pure & deterministic. */
export function buildConversation(events: readonly StampedAgentEvent[]): Conversation {
  const items: ConversationItem[] = [];
  const toolIndex = new Map<string, number>();
  // messageId → item index, so streaming chunks bucket into one item regardless of interleaving.
  const messageIndex = new Map<string, number>();
  const planIndexByTurn = new Map<ConversationTurnId, number>();
  const closedTurnIds = new Set<string>();
  let currentTurnId: ConversationTurnId = null;
  let gen = 0;
  const genId = (prefix: string): string => `${prefix}-${gen++}`;
  const nextTurnId = (): string => genId('turn');

  let status: SessionStatus | null = null;
  let usage: TokenUsage | null = null;
  let currentModeId: string | null = null;
  let stopReason: StopReason | null = null;

  // Bucket an agent message / thought chunk into its messageId-keyed item (creating it on first sight).
  const openAgentStream = (
    kind: 'message' | 'reasoning',
    messageId: string,
    block: ContentBlock,
    receivedAt: number | undefined,
  ): void => {
    const existing = messageIndex.get(messageId);
    if (existing !== undefined) {
      const item = items[existing];
      if (item.kind === kind) {
        appendBlock(item.blocks, block);
        item.receivedAt = receivedAt ?? item.receivedAt;
        return;
      }
    }
    if (kind === 'message') {
      items.push({
        kind: 'message',
        id: messageId,
        turnId: currentTurnId,
        role: 'assistant',
        blocks: [block],
        isStreaming: false,
        receivedAt,
      });
    } else {
      items.push({
        kind: 'reasoning',
        id: messageId,
        turnId: currentTurnId,
        blocks: [block],
        isStreaming: false,
        receivedAt,
      });
    }
    messageIndex.set(messageId, items.length - 1);
  };

  for (const event of events) {
    switch (event.type) {
      case 'user-message': {
        // A complete, atomic message: opens a new turn and is pushed whole (never grouped/appended).
        currentTurnId = nextTurnId();
        items.push({
          kind: 'message',
          id: event.messageId ?? genId('user-message'),
          turnId: currentTurnId,
          role: 'user',
          blocks: [...event.content],
          isStreaming: false,
          receivedAt: event.receivedAt,
        });
        break;
      }
      case 'agent-message-chunk':
        openAgentStream('message', event.messageId, event.content, event.receivedAt);
        break;
      case 'agent-thought-chunk':
        openAgentStream('reasoning', event.messageId, event.content, event.receivedAt);
        break;

      case 'tool-call': {
        // Every event is a full snapshot, so replace-by-id; no merge, no synthesis.
        const existing = toolIndex.get(event.toolCall.toolCallId);
        if (existing === undefined) {
          items.push({
            kind: 'tool',
            id: event.toolCall.toolCallId,
            turnId: currentTurnId,
            toolCall: event.toolCall,
            receivedAt: event.receivedAt,
          });
          toolIndex.set(event.toolCall.toolCallId, items.length - 1);
        } else {
          const item = items[existing];
          if (item.kind === 'tool') {
            item.toolCall = event.toolCall;
            item.receivedAt = event.receivedAt ?? item.receivedAt;
          }
        }
        break;
      }

      case 'plan': {
        const planIndex = planIndexByTurn.get(currentTurnId);
        if (planIndex === undefined) {
          items.push({
            kind: 'plan',
            id: genId('plan'),
            turnId: currentTurnId,
            plan: event.plan,
            receivedAt: event.receivedAt,
          });
          planIndexByTurn.set(currentTurnId, items.length - 1);
          break;
        }
        const item = items[planIndex];
        if (item.kind === 'plan') item.plan = event.plan;
        break;
      }

      case 'current-mode-update':
        currentModeId = event.currentModeId;
        break;
      case 'status':
        status = event.status;
        break;
      case 'token-usage':
        usage = event.usage;
        break;
      case 'stop':
        stopReason = event.stopReason;
        if (currentTurnId) {
          closedTurnIds.add(currentTurnId);
          currentTurnId = null;
        }
        break;

      case 'error':
        items.push({
          kind: 'error',
          id: genId('error'),
          turnId: currentTurnId,
          message: event.message,
          code: event.code,
          recoverable: event.recoverable,
          receivedAt: event.receivedAt,
        });
        break;

      case 'permission-request':
        items.push({
          kind: 'approval',
          id: event.requestId,
          turnId: currentTurnId,
          requestId: event.requestId,
          toolCall: event.toolCall,
          options: event.options,
          receivedAt: event.receivedAt,
        });
        break;
      default:
        break;
    }
  }

  // A permission ask is "pending" until its referenced tool call reaches a terminal status.
  const pendingPermissionIds: string[] = [];
  for (const item of items) {
    if (item.kind !== 'approval') continue;
    if (item.turnId && closedTurnIds.has(item.turnId)) continue;
    const toolItemIndex = toolIndex.get(item.toolCall.toolCallId);
    const toolItem = toolItemIndex === undefined ? undefined : items[toolItemIndex];
    const settled =
      toolItem?.kind === 'tool' &&
      (toolItem.toolCall.status === 'completed' || toolItem.toolCall.status === 'failed');
    if (!settled) pendingPermissionIds.push(item.requestId);
  }

  const isSessionStreaming = status === 'running' || status === 'starting';
  if (isSessionStreaming) {
    const last = items.at(-1);
    if (last?.kind === 'reasoning' || (last?.kind === 'message' && last.role === 'assistant')) {
      last.isStreaming = true;
    }
  }

  return {
    items,
    status,
    usage,
    currentModeId,
    stopReason,
    pendingPermissionIds,
  };
}

/** A point-in-time transcript snapshot: past events read from provider history, plus the live
 * stream's receive counter sampled when the read resolved (see `LinkCodeClient.eventSeq`). */
export interface ConversationSeed {
  events: AgentEvent[];
  /** The snapshot covers every live event with seq ≤ this; 0 = supersedes nothing. */
  uptoSeq: number;
}

/**
 * Prepend a transcript snapshot to the live event stream. The cut is ordered, not clocked: live
 * events received at or before the moment the snapshot resolved (seq ≤ uptoSeq) are contained in
 * it and dropped; only the tail received after the snapshot is appended. Live events keep their
 * client receive time; snapshot events have none.
 */
export function mergeSeededEvents(
  seed: ConversationSeed | undefined,
  live: readonly SequencedAgentEvent[],
): StampedAgentEvent[] {
  if (!seed) return live.map(({ event, receivedAt }) => ({ ...event, receivedAt }));
  const merged: StampedAgentEvent[] = [...seed.events];
  for (const { event, seq, receivedAt } of live) {
    if (seq > seed.uptoSeq) merged.push({ ...event, receivedAt });
  }
  return merged;
}

/** Extract a flat preview string from content blocks (used for list previews / titles). */
export function contentPreview(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((b) => (b.type === 'text' ? b.text : `[${b.type}]`))
    .join(' ')
    .trim();
}

/** Pull the file diffs out of a tool call's content (for diff-aware rendering). */
export function toolCallDiffs(
  toolCall: ToolCall,
): Array<Extract<ToolCallContent, { type: 'diff' }>> {
  return toolCall.content.filter(
    (c): c is Extract<ToolCallContent, { type: 'diff' }> => c.type === 'diff',
  );
}
