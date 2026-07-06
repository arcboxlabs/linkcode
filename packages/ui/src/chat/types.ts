import type {
  ContentBlock,
  PermissionOption,
  Plan,
  SessionStatus,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolCallUpdate,
} from '@linkcode/schema';

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
  /** Permission requests still awaiting a decision. */
  pendingPermissionIds: string[];
}
