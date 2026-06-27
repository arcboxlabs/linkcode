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

export interface ConversationViewModel {
  items: ConversationItem[];
  status: SessionStatus | null;
  usage: TokenUsage | null;
  currentModeId: string | null;
  stopReason: StopReason | null;
  pendingPermissionIds: string[];
}
