import type {
  ContentBlock,
  PermissionOption,
  Plan,
  Question,
  ToolCall,
  ToolCallUpdate,
} from '@linkcode/schema';

/**
 * Structural mirror of client-core's `ConversationItem` (same pattern as the web half's
 * `src/chat/types.ts`): built purely from `@linkcode/schema` types so this package never
 * imports the client runtime. `apps/mobile` passes client-core items straight through.
 */
interface ChatItemBase {
  id: string;
  turnId: string | null;
  receivedAt?: number;
}

export type ChatTimelineItem =
  | (ChatItemBase & {
      kind: 'message';
      role: 'user' | 'assistant';
      blocks: ContentBlock[];
      isStreaming: boolean;
      parentToolCallId?: string;
    })
  | (ChatItemBase & {
      kind: 'reasoning';
      blocks: ContentBlock[];
      isStreaming: boolean;
      parentToolCallId?: string;
    })
  | (ChatItemBase & { kind: 'tool'; toolCall: ToolCall })
  | (ChatItemBase & {
      kind: 'compaction';
      trigger?: 'manual' | 'auto';
      preTokens?: number;
      postTokens?: number;
      summary?: string;
    })
  | (ChatItemBase & { kind: 'plan'; plan: Plan })
  | (ChatItemBase & {
      kind: 'approval';
      requestId: string;
      toolCall: ToolCallUpdate;
      options: PermissionOption[];
    })
  | (ChatItemBase & {
      kind: 'question';
      requestId: string;
      toolCall: ToolCallUpdate;
      questions: Question[];
    })
  | (ChatItemBase & { kind: 'error'; message: string; code?: string; recoverable: boolean });
