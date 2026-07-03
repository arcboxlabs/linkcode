import type {
  ContentBlock,
  PermissionOption,
  PermissionOutcome,
  Plan,
  SessionStatus,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolCallUpdate,
} from '@linkcode/schema';

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
      /** How the ask settled (from `permission-resolved`); absent while it is still open. */
      resolution?: PermissionOutcome;
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
  /** Why the last turn ended (if it did). */
  stopReason: StopReason | null;
  /** Permission requests still awaiting a decision. */
  pendingPermissionIds: string[];
}
