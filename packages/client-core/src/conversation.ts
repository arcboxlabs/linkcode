import type {
  AgentEvent,
  AvailableCommand,
  ClientRequest,
  ContentBlock,
  PermissionOption,
  Plan,
  SessionConfigOption,
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

export type ConversationTurnId = string | null;

/** A single semantic item in the conversation timeline. */
export type ConversationItem =
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
      kind: 'client-request';
      id: string;
      turnId: ConversationTurnId;
      requestId: string;
      request: ClientRequest;
    }
  | {
      kind: 'error';
      id: string;
      turnId: ConversationTurnId;
      message: string;
      code?: string;
      recoverable: boolean;
    };

export interface ConversationViewModel {
  /** Ordered timeline of everything the user should see. */
  items: ConversationItem[];
  /** Coarse session lifecycle, from the latest `status` event. */
  status: SessionStatus | null;
  /** Latest cumulative token usage. */
  usage: TokenUsage | null;
  /** Active session mode id (e.g. plan / accept-edits), from `current-mode-update`. */
  currentModeId: string | null;
  /** Slash commands the agent currently advertises. */
  availableCommands: AvailableCommand[];
  /** Free-form per-session config options the agent exposes. */
  configOptions: SessionConfigOption[];
  /** Why the last turn ended (if it did). */
  stopReason: StopReason | null;
  /**
   * requestIds of permission asks that are still open — i.e. their referenced tool call hasn't reached a
   * terminal status. The UI additionally hides ones the user already answered in this client.
   */
  pendingPermissionIds: string[];
}

export type Conversation = ConversationViewModel;

type MessageRole = Extract<ConversationItem, { kind: 'message' }>['role'];

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

/** Merge a ToolCallUpdate onto an existing ToolCall (later fields win; absent fields are kept). */
function mergeToolCall(base: ToolCall, update: ToolCallUpdate): ToolCall {
  return {
    ...base,
    title: update.title ?? base.title,
    kind: update.kind ?? base.kind,
    status: update.status ?? base.status,
    content: update.content ?? base.content,
    locations: update.locations ?? base.locations,
    rawInput: update.rawInput ?? base.rawInput,
    rawOutput: update.rawOutput ?? base.rawOutput,
  };
}

/** Build a structured Conversation from the flat, append-only agent event stream. Pure & deterministic. */
export function buildConversation(events: readonly AgentEvent[]): Conversation {
  const items: ConversationItem[] = [];
  const toolIndex = new Map<string, number>();
  const planIndexByTurn = new Map<ConversationTurnId, number>();
  let currentTurnId: ConversationTurnId = null;
  let gen = 0;
  const genId = (prefix: string): string => `${prefix}-${gen++}`;
  const nextTurnId = (): string => genId('turn');

  let status: SessionStatus | null = null;
  let usage: TokenUsage | null = null;
  let currentModeId: string | null = null;
  let availableCommands: AvailableCommand[] = [];
  let configOptions: SessionConfigOption[] = [];
  let stopReason: StopReason | null = null;

  const openMessage = (role: MessageRole, block: ContentBlock): void => {
    const last = items.at(-1);
    if (last?.kind === 'message' && last.role === role) {
      appendBlock(last.blocks, block);
      return;
    }
    if (role === 'user') currentTurnId = nextTurnId();
    items.push({
      kind: 'message',
      id: genId(`${role}-message`),
      turnId: currentTurnId,
      role,
      blocks: [block],
      isStreaming: false,
    });
  };

  const openReasoning = (block: ContentBlock): void => {
    const last = items.at(-1);
    if (last?.kind === 'reasoning') {
      appendBlock(last.blocks, block);
      return;
    }
    items.push({
      kind: 'reasoning',
      id: genId('reasoning'),
      turnId: currentTurnId,
      blocks: [block],
      isStreaming: false,
    });
  };

  for (const event of events) {
    switch (event.type) {
      case 'user-message-chunk':
        openMessage('user', event.content);
        break;
      case 'agent-message-chunk':
        openMessage('assistant', event.content);
        break;
      case 'agent-thought-chunk':
        openReasoning(event.content);
        break;

      case 'tool-call': {
        const existing = toolIndex.get(event.toolCall.toolCallId);
        if (existing === undefined) {
          items.push({
            kind: 'tool',
            id: event.toolCall.toolCallId,
            turnId: currentTurnId,
            toolCall: event.toolCall,
          });
          toolIndex.set(event.toolCall.toolCallId, items.length - 1);
        } else {
          const item = items[existing];
          if (item.kind === 'tool') {
            item.toolCall = mergeToolCall(item.toolCall, event.toolCall);
          }
        }
        break;
      }

      case 'tool-call-update': {
        const existing = toolIndex.get(event.update.toolCallId);
        if (existing === undefined) {
          // Update before its tool-call (defensive): synthesize a tool call from the update.
          const synthesized: ToolCall = {
            toolCallId: event.update.toolCallId,
            title: event.update.title ?? event.update.toolCallId,
            kind: event.update.kind ?? 'other',
            status: event.update.status ?? 'in_progress',
            content: event.update.content ?? [],
            locations: event.update.locations,
            rawInput: event.update.rawInput,
            rawOutput: event.update.rawOutput,
          };
          items.push({
            kind: 'tool',
            id: synthesized.toolCallId,
            turnId: currentTurnId,
            toolCall: synthesized,
          });
          toolIndex.set(synthesized.toolCallId, items.length - 1);
        } else {
          const item = items[existing];
          if (item.kind === 'tool') {
            item.toolCall = mergeToolCall(item.toolCall, event.update);
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
          });
          planIndexByTurn.set(currentTurnId, items.length - 1);
          break;
        }
        const item = items[planIndex];
        if (item.kind === 'plan') item.plan = event.plan;
        break;
      }

      case 'available-commands-update':
        availableCommands = event.availableCommands;
        break;
      case 'current-mode-update':
        currentModeId = event.currentModeId;
        break;
      case 'config-option-update':
        configOptions = event.configOptions;
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
        });
        break;

      case 'client-request':
        items.push({
          kind: 'client-request',
          id: event.requestId,
          turnId: currentTurnId,
          requestId: event.requestId,
          request: event.request,
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
    availableCommands,
    configOptions,
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
