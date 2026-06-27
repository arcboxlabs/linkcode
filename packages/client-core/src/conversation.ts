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
 * structured timeline (turn-grouped messages, tool calls merged from their updates, plan, permissions)
 * plus the session's live lifecycle state. `buildConversation` is a pure reducer over the event list so
 * it can be unit-tested without a transport (mirrors the adapter normalizer convention).
 */

/** A single rendered item in the conversation timeline. */
export type ConversationItem =
  | { kind: 'user-message'; id: string; blocks: ContentBlock[] }
  | { kind: 'assistant-message'; id: string; blocks: ContentBlock[] }
  | { kind: 'thought'; id: string; blocks: ContentBlock[] }
  | { kind: 'tool-call'; id: string; toolCall: ToolCall }
  | { kind: 'plan'; id: string; plan: Plan }
  | {
      kind: 'permission';
      id: string;
      requestId: string;
      toolCall: ToolCallUpdate;
      options: PermissionOption[];
    }
  | { kind: 'error'; id: string; message: string; code?: string; recoverable: boolean };

export interface Conversation {
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

/** Build a structured Conversation from the flat, append-only agent event stream. Pure & deterministic. */
export function buildConversation(events: readonly AgentEvent[]): Conversation {
  const items: ConversationItem[] = [];
  const toolIndex = new Map<string, number>();
  // messageId → item index, so streaming chunks bucket into one bubble regardless of interleaving.
  const messageIndex = new Map<string, number>();
  let planIndex = -1;
  let gen = 0;
  const genId = (prefix: string): string => `${prefix}-${gen++}`;

  let status: SessionStatus | null = null;
  let usage: TokenUsage | null = null;
  let currentModeId: string | null = null;
  let stopReason: StopReason | null = null;

  const openMessage = (
    kind: 'assistant-message' | 'thought',
    messageId: string,
    block: ContentBlock,
  ): void => {
    const existing = messageIndex.get(messageId);
    if (existing !== undefined) {
      const item = items[existing];
      if (item.kind === kind) {
        appendBlock(item.blocks, block);
        return;
      }
    }
    items.push({ kind, id: messageId, blocks: [block] });
    messageIndex.set(messageId, items.length - 1);
  };

  for (const event of events) {
    switch (event.type) {
      case 'user-message':
        // A complete, atomic message — pushed whole, never grouped or appended to.
        items.push({
          kind: 'user-message',
          id: event.messageId ?? genId('user-message'),
          blocks: event.content,
        });
        break;
      case 'agent-message-chunk':
        openMessage('assistant-message', event.messageId, event.content);
        break;
      case 'agent-thought-chunk':
        openMessage('thought', event.messageId, event.content);
        break;

      case 'tool-call': {
        // Every event is a full snapshot, so replace-by-id; no merge, no synthesis, no create check.
        const existing = toolIndex.get(event.toolCall.toolCallId);
        if (existing === undefined) {
          items.push({
            kind: 'tool-call',
            id: event.toolCall.toolCallId,
            toolCall: event.toolCall,
          });
          toolIndex.set(event.toolCall.toolCallId, items.length - 1);
        } else {
          const item = items[existing];
          if (item.kind === 'tool-call') item.toolCall = event.toolCall;
        }
        break;
      }

      case 'plan':
        if (planIndex >= 0) {
          const item = items[planIndex];
          if (item.kind === 'plan') item.plan = event.plan;
        } else {
          items.push({ kind: 'plan', id: 'plan', plan: event.plan });
          planIndex = items.length - 1;
        }
        break;

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
          message: event.message,
          code: event.code,
          recoverable: event.recoverable,
        });
        break;

      case 'permission-request':
        items.push({
          kind: 'permission',
          id: event.requestId,
          requestId: event.requestId,
          toolCall: event.toolCall,
          options: event.options,
        });
        break;
      default:
        break;
    }
  }

  // A permission ask is "pending" until its referenced tool call reaches a terminal status.
  const pendingPermissionIds: string[] = [];
  for (const item of items) {
    if (item.kind !== 'permission') continue;
    const toolItemIndex = toolIndex.get(item.toolCall.toolCallId);
    const toolItem = toolItemIndex === undefined ? undefined : items[toolItemIndex];
    const settled =
      toolItem?.kind === 'tool-call' &&
      (toolItem.toolCall.status === 'completed' || toolItem.toolCall.status === 'failed');
    if (!settled) pendingPermissionIds.push(item.requestId);
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
