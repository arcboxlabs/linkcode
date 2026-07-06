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

/**
 * Conversation view-model. The daemon streams a flat, append-only `AgentEvent[]`; the UI needs a
 * structured timeline (turn-grouped messages bucketed by messageId, tool calls as full snapshots, plan,
 * permissions) plus the session's live lifecycle state. `buildConversation` is a pure reducer over the
 * event list so it can be unit-tested without a transport (mirrors the adapter normalizer convention).
 */

export type ConversationTurnId = string | null;

/** A single semantic item in the conversation timeline. `receivedAt` is the client receive time of
 * the item's latest event (see {@link SequencedAgentEvent}); it drives relative timestamps in the
 * UI and is absent for items reconstructed from a history read. */
export type ConversationItem = (
  | {
      kind: 'message';
      id: string;
      turnId: ConversationTurnId;
      role: 'user' | 'assistant';
      blocks: ContentBlock[];
      isStreaming: boolean;
    }
  | {
      kind: 'reasoning';
      id: string;
      turnId: ConversationTurnId;
      blocks: ContentBlock[];
      isStreaming: boolean;
    }
  | { kind: 'tool'; id: string; turnId: ConversationTurnId; toolCall: ToolCall }
  | { kind: 'plan'; id: string; turnId: ConversationTurnId; plan: Plan }
  | {
      kind: 'approval';
      id: string;
      turnId: ConversationTurnId;
      requestId: string;
      toolCall: ToolCallUpdate;
      options: PermissionOption[];
    }
  | {
      kind: 'error';
      id: string;
      turnId: ConversationTurnId;
      message: string;
      code?: string;
      recoverable: boolean;
    }
) & { receivedAt?: number };

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

/** Append a content block, concatenating consecutive text blocks for smooth streaming. Pure:
 * returns a fresh array so previously emitted snapshots never observe the append. */
function appendBlock(blocks: readonly ContentBlock[], block: ContentBlock): ContentBlock[] {
  const last = blocks.at(-1);
  if (last?.type === 'text' && block.type === 'text') {
    return [
      ...blocks.slice(0, -1),
      {
        ...last,
        text: last.text + block.text,
        annotations: block.annotations ?? last.annotations,
      },
    ];
  }
  return [...blocks, block];
}

export interface ConversationBuilder {
  /** Fold one more event into the running state. `receivedAt` is the client receive time to stamp
   * on the item(s) this event touches (omitted for events replayed from a history read). */
  advance(event: AgentEvent, receivedAt?: number): void;
  /** The current view-model. Cached between advances; every changed item is a fresh object
   * (copy-on-write), so React memoization over items keeps working across snapshots. */
  snapshot(): Conversation;
}

/**
 * Incremental form of {@link buildConversation}: the same fold, but advanced one event at a time
 * so a streaming delta costs O(delta) instead of re-reducing the whole history. Item updates are
 * copy-on-write — previously returned snapshots are never mutated retroactively.
 */
export function createConversationBuilder(): ConversationBuilder {
  const items: ConversationItem[] = [];
  const toolIndex = new Map<string, number>();
  // messageId → item index, so streaming chunks bucket into one item regardless of interleaving.
  const messageIndex = new Map<string, number>();
  const planIndexByTurn = new Map<ConversationTurnId, number>();
  /** Asks in arrival order; each stays "pending" until its tool call reaches a terminal status. */
  const approvals: Array<{ requestId: string; toolCallId: string }> = [];
  let currentTurnId: ConversationTurnId = null;
  let gen = 0;
  let status: SessionStatus | null = null;
  let usage: TokenUsage | null = null;
  let currentModeId: string | null = null;
  let stopReason: StopReason | null = null;
  let cached: Conversation | null = null;

  const genId = (prefix: string): string => `${prefix}-${gen++}`;

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
        items[existing] = {
          ...item,
          blocks: appendBlock(item.blocks, block),
          receivedAt: receivedAt ?? item.receivedAt,
        };
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

  const advance = (event: AgentEvent, receivedAt?: number): void => {
    cached = null;
    switch (event.type) {
      case 'user-message': {
        // A complete, atomic message: opens a new turn and is pushed whole (never grouped/appended).
        currentTurnId = genId('turn');
        items.push({
          kind: 'message',
          id: event.messageId ?? genId('user-message'),
          turnId: currentTurnId,
          role: 'user',
          blocks: [...event.content],
          isStreaming: false,
          receivedAt,
        });
        break;
      }
      case 'agent-message-chunk':
        openAgentStream('message', event.messageId, event.content, receivedAt);
        break;
      case 'agent-thought-chunk':
        openAgentStream('reasoning', event.messageId, event.content, receivedAt);
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
            receivedAt,
          });
          toolIndex.set(event.toolCall.toolCallId, items.length - 1);
        } else {
          const item = items[existing];
          if (item.kind === 'tool') {
            items[existing] = {
              ...item,
              toolCall: event.toolCall,
              receivedAt: receivedAt ?? item.receivedAt,
            };
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
            receivedAt,
          });
          planIndexByTurn.set(currentTurnId, items.length - 1);
          break;
        }
        const item = items[planIndex];
        if (item.kind === 'plan') {
          items[planIndex] = {
            ...item,
            plan: event.plan,
            receivedAt: receivedAt ?? item.receivedAt,
          };
        }
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
        break;

      case 'error':
        items.push({
          kind: 'error',
          id: genId('error'),
          turnId: currentTurnId,
          message: event.message,
          code: event.code,
          recoverable: event.recoverable,
          receivedAt,
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
          receivedAt,
        });
        approvals.push({ requestId: event.requestId, toolCallId: event.toolCall.toolCallId });
        break;
      default:
        break;
    }
  };

  const snapshot = (): Conversation => {
    if (cached) return cached;

    const out = [...items];
    const isSessionStreaming = status === 'running' || status === 'starting';
    if (isSessionStreaming) {
      const last = out.at(-1);
      if (last?.kind === 'reasoning' || (last?.kind === 'message' && last.role === 'assistant')) {
        out[out.length - 1] = { ...last, isStreaming: true };
      }
    }

    // A permission ask is "pending" until its referenced tool call reaches a terminal status.
    const pendingPermissionIds: string[] = [];
    for (const approval of approvals) {
      const toolItemIndex = toolIndex.get(approval.toolCallId);
      const toolItem = toolItemIndex === undefined ? undefined : items[toolItemIndex];
      const settled =
        toolItem?.kind === 'tool' &&
        (toolItem.toolCall.status === 'completed' || toolItem.toolCall.status === 'failed');
      if (!settled) pendingPermissionIds.push(approval.requestId);
    }

    cached = {
      items: out,
      status,
      usage,
      currentModeId,
      stopReason,
      pendingPermissionIds,
    };
    return cached;
  };

  return { advance, snapshot };
}

/** Build a structured Conversation from the flat, append-only agent event stream. Pure & deterministic. */
export function buildConversation(events: readonly AgentEvent[]): Conversation {
  const builder = createConversationBuilder();
  for (const event of events) builder.advance(event);
  return builder.snapshot();
}

/** A point-in-time transcript snapshot: past events read from provider history, plus the live
 * stream's receive counter sampled when the read resolved (see `LinkCodeClient.eventSeq`). The
 * conversation store folds the seed first, then only the live events past the `uptoSeq` cut. */
export interface ConversationSeed {
  events: AgentEvent[];
  /** The snapshot covers every live event with seq ≤ this; 0 = supersedes nothing. */
  uptoSeq: number;
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
