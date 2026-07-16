import type {
  AgentCapabilities,
  AgentCommand,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  PermissionOption,
  Plan,
  Question,
  SessionStatus,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolCallUpdate,
} from '@linkcode/schema';

export type ConversationTurnId = string | null;

/** `receivedAt` = client receive time of the item's latest event — TODO(wire): approximate and
 * absent for history-seeded items; replace once the wire carries an authoritative timestamp. */
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
      /** Set on subagent narration: the `task`-kind tool call that spawned it (nested in the UI). */
      parentToolCallId?: string;
    })
  | (ConversationItemBase & {
      kind: 'reasoning';
      blocks: ContentBlock[];
      isStreaming: boolean;
      parentToolCallId?: string;
    })
  | (ConversationItemBase & { kind: 'tool'; toolCall: ToolCall })
  | (ConversationItemBase & {
      kind: 'compaction';
      trigger?: 'manual' | 'auto';
      preTokens?: number;
      postTokens?: number;
      summary?: string;
    })
  | (ConversationItemBase & { kind: 'plan'; plan: Plan })
  | (ConversationItemBase & {
      kind: 'approval';
      requestId: string;
      toolCall: ToolCallUpdate;
      options: PermissionOption[];
    })
  | (ConversationItemBase & {
      kind: 'question';
      requestId: string;
      toolCall: ToolCallUpdate;
      questions: Question[];
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
  /** Advertised approval-policy state (the permission axis), from `approval-policy-update`;
   * null (or an empty list) hides the composer's policy menu. */
  approvalPolicy: ApprovalPolicyState | null;
  /** The model the session is running on, from `model-update`; null until the adapter reports it. */
  currentModel: string | null;
  /** The reasoning-effort level the session is running at, from `effort-update`; null until reported. */
  currentEffort: EffortLevel | null;
  /** Slash-command catalog from `available-commands-update`; null hides the composer's command menu. */
  availableCommands: AgentCommand[] | null;
  /** Adapter input features from `capabilities-update`; null until the session advertises. */
  capabilities: AgentCapabilities | null;
  /** Why the last turn ended (if it did). */
  stopReason: StopReason | null;
  /** Permission requests still awaiting a decision. */
  pendingPermissionIds: string[];
  /** Question requests still awaiting answers. */
  pendingQuestionIds: string[];
}
