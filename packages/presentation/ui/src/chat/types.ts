import type {
  AgentCapabilities,
  AgentCommand,
  AgentModelOption,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  PermissionOption,
  PermissionOutcome,
  Plan,
  PromptResolutionSource,
  Question,
  QuestionOutcome,
  SessionStatus,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolCallUpdate,
} from '@linkcode/schema';

export type ConversationTurnId = string | null;

/**
 * Fields every timeline item carries. `receivedAt` is the best-known time of the item's latest
 * event: client receive time for live events, the provider's own timestamp for history-seeded
 * items, absent when neither is known.
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
      /** Set on subagent narration: the `task`-kind tool call that spawned it (nested in the UI). */
      parentToolCallId?: string;
      /** The model serving the session when this assistant message opened (from `model-update`). */
      model?: string;
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
      /** Absent means completed; `in_progress` renders as a live "compacting…" row. */
      status?: 'in_progress' | 'completed';
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
      responding: boolean;
      resolution?: { outcome: PermissionOutcome; source: PromptResolutionSource };
    })
  | (ConversationItemBase & {
      kind: 'question';
      requestId: string;
      toolCall: ToolCallUpdate;
      questions: Question[];
      responding: boolean;
      resolution?: { outcome: QuestionOutcome; source: PromptResolutionSource };
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
  /** Adapter-advertised model catalog from `available-models-update` (install-dependent agents);
   * null falls the composer back to its static per-kind model table. */
  availableModels: AgentModelOption[] | null;
  /** Adapter input features from `capabilities-update`; null until the session advertises. */
  capabilities: AgentCapabilities | null;
  /** Why the last turn ended (if it did). */
  stopReason: StopReason | null;
  /** Permission requests still awaiting a decision. */
  pendingPermissionIds: string[];
  /** Question requests still awaiting answers. */
  pendingQuestionIds: string[];
}
