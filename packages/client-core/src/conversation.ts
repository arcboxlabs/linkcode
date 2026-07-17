import type {
  AgentCapabilities,
  AgentCommand,
  AgentEvent,
  AgentModelOption,
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
  ToolCallContent,
  ToolCallUpdate,
  UsageReport,
} from '@linkcode/schema';

/**
 * Conversation view-model. The daemon streams a flat, append-only `AgentEvent[]`; the UI needs a
 * structured timeline (turn-grouped messages bucketed by messageId, tool calls as full snapshots, plan,
 * permissions) plus the session's live lifecycle state. `buildConversation` is a pure reducer over the
 * event list so it can be unit-tested without a transport (mirrors the adapter normalizer convention).
 */

export type ConversationTurnId = string | null;
export type PermissionResolution = Pick<
  Extract<AgentEvent, { type: 'permission-resolved' }>,
  'outcome' | 'source'
>;
export type QuestionResolution = Pick<
  Extract<AgentEvent, { type: 'question-resolved' }>,
  'outcome' | 'source'
>;

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
      /** Set on subagent narration: the `task`-kind tool call that spawned it (nested in the UI). */
      parentToolCallId?: string;
    }
  | {
      kind: 'reasoning';
      id: string;
      turnId: ConversationTurnId;
      blocks: ContentBlock[];
      isStreaming: boolean;
      parentToolCallId?: string;
    }
  | { kind: 'tool'; id: string; turnId: ConversationTurnId; toolCall: ToolCall }
  | {
      kind: 'compaction';
      /** The provider's compaction boundary id — partial re-emits merge into one marker by it. */
      id: string;
      turnId: ConversationTurnId;
      trigger?: 'manual' | 'auto';
      preTokens?: number;
      postTokens?: number;
      summary?: string;
    }
  | { kind: 'plan'; id: string; turnId: ConversationTurnId; plan: Plan }
  | {
      kind: 'approval';
      id: string;
      turnId: ConversationTurnId;
      requestId: string;
      toolCall: ToolCallUpdate;
      options: PermissionOption[];
      responding: boolean;
      resolution?: PermissionResolution;
    }
  | {
      kind: 'question';
      id: string;
      turnId: ConversationTurnId;
      requestId: string;
      toolCall: ToolCallUpdate;
      questions: Question[];
      responding: boolean;
      resolution?: QuestionResolution;
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
  /** Latest structured usage snapshot, from `usage-report` (the whole reply of a provider usage
   * command such as claude-code's `/usage` — the invocation produces no transcript text). Replaced
   * wholesale per report; `null` until the session serves one. */
  usageReport: UsageReport | null;
  /** Active session mode id (e.g. plan / accept-edits), from `current-mode-update`. */
  currentModeId: string | null;
  /** Advertised approval-policy state (the permission axis), from `approval-policy-update`;
   * null (or an empty list) means the agent has no switchable policies and the UI hides the menu. */
  approvalPolicy: ApprovalPolicyState | null;
  /** The model the session is actually running on, from `model-update`. `null` until the adapter
   * reports it (before the first turn, or for adapters that can't observe their model) — the composer
   * then shows a placeholder rather than a guess. */
  currentModel: string | null;
  /** The reasoning-effort level the session is running at, from `effort-update`. `null` until the
   * adapter reports it — same placeholder rule as `currentModel`. */
  currentEffort: EffortLevel | null;
  /** Slash-command catalog from `available-commands-update` (full-replace). `null` means the agent
   * advertised none — the composer then offers no command menu. */
  availableCommands: AgentCommand[] | null;
  /** Model catalog from `available-models-update` (full-replace). `null` means the agent
   * advertised none — the composer then falls back to its static per-kind table. */
  availableModels: AgentModelOption[] | null;
  /** Adapter input features from `capabilities-update`; null until the live session advertises. */
  capabilities: AgentCapabilities | null;
  /** Why the last turn ended (if it did). */
  stopReason: StopReason | null;
  /**
   * requestIds of permission asks that have no authoritative resolution event yet.
   */
  pendingPermissionIds: string[];
  /** requestIds of question asks that are still open, tracked the same way as permission asks. */
  pendingQuestionIds: string[];
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
  // compactionId → item index, so partial compaction re-emits merge into one marker.
  const compactionIndex = new Map<string, number>();
  const planIndexByTurn = new Map<ConversationTurnId, number>();
  /** Asks in arrival order; explicit resolution events are their only settlement authority. */
  const approvals: string[] = [];
  const questionAsks: string[] = [];
  const approvalIndex = new Map<string, number>();
  const questionIndex = new Map<string, number>();
  const permissionResolutions = new Map<string, PermissionResolution>();
  const questionResolutions = new Map<string, QuestionResolution>();
  const promptResponseStatuses = new Map<string, 'open' | 'responding'>();
  /** Every ask requestId ever folded — attach-replayed duplicates are dropped. */
  const seenAskIds = new Set<string>();
  let currentTurnId: ConversationTurnId = null;
  let gen = 0;
  let status: SessionStatus | null = null;
  let usage: TokenUsage | null = null;
  let usageReport: UsageReport | null = null;
  let currentModeId: string | null = null;
  let approvalPolicy: ApprovalPolicyState | null = null;
  let currentModel: string | null = null;
  let currentEffort: EffortLevel | null = null;
  let availableCommands: AgentCommand[] | null = null;
  let availableModels: AgentModelOption[] | null = null;
  let capabilities: AgentCapabilities | null = null;
  let stopReason: StopReason | null = null;
  let cached: Conversation | null = null;

  const genId = (prefix: string): string => `${prefix}-${gen++}`;

  // Bucket an agent message / thought chunk into its messageId-keyed item (creating it on first sight).
  const openAgentStream = (
    kind: 'message' | 'reasoning',
    messageId: string,
    block: ContentBlock,
    receivedAt: number | undefined,
    parentToolCallId: string | undefined,
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
        parentToolCallId,
        receivedAt,
      });
    } else {
      items.push({
        kind: 'reasoning',
        id: messageId,
        turnId: currentTurnId,
        blocks: [block],
        isStreaming: false,
        parentToolCallId,
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
        openAgentStream(
          'message',
          event.messageId,
          event.content,
          receivedAt,
          event.parentToolCallId,
        );
        break;
      case 'agent-thought-chunk':
        openAgentStream(
          'reasoning',
          event.messageId,
          event.content,
          receivedAt,
          event.parentToolCallId,
        );
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

      case 'compaction': {
        // The adapter emits the boundary first (metadata only) and again once the summary text is
        // known; history replay repeats the same compactionId. Merge instead of replacing so a
        // later partial emit never wipes fields an earlier one carried.
        const existing = compactionIndex.get(event.compactionId);
        if (existing === undefined) {
          items.push({
            kind: 'compaction',
            id: event.compactionId,
            turnId: currentTurnId,
            trigger: event.trigger,
            preTokens: event.preTokens,
            postTokens: event.postTokens,
            summary: event.summary,
            receivedAt,
          });
          compactionIndex.set(event.compactionId, items.length - 1);
          break;
        }
        const item = items[existing];
        if (item.kind === 'compaction') {
          items[existing] = {
            ...item,
            trigger: event.trigger ?? item.trigger,
            preTokens: event.preTokens ?? item.preTokens,
            postTokens: event.postTokens ?? item.postTokens,
            summary: event.summary ?? item.summary,
            receivedAt: receivedAt ?? item.receivedAt,
          };
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
      case 'approval-policy-update':
        approvalPolicy = event.state;
        break;
      case 'model-update':
        currentModel = event.model;
        break;
      case 'effort-update':
        currentEffort = event.effort;
        break;
      case 'available-commands-update':
        availableCommands = event.commands;
        break;
      case 'available-models-update':
        availableModels = event.models;
        break;
      case 'capabilities-update':
        capabilities = event.capabilities;
        break;
      case 'status':
        status = event.status;
        break;
      case 'token-usage':
        usage = event.usage;
        break;
      case 'usage-report':
        usageReport = event.report;
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
        // The engine re-broadcasts open asks on session.attach; a duplicate must not add a card.
        if (seenAskIds.has(event.requestId)) break;
        seenAskIds.add(event.requestId);
        items.push({
          kind: 'approval',
          id: event.requestId,
          turnId: currentTurnId,
          requestId: event.requestId,
          toolCall: event.toolCall,
          options: event.options,
          responding:
            !permissionResolutions.has(event.requestId) &&
            promptResponseStatuses.get(event.requestId) === 'responding',
          resolution: permissionResolutions.get(event.requestId),
          receivedAt,
        });
        approvalIndex.set(event.requestId, items.length - 1);
        approvals.push(event.requestId);
        break;
      case 'question-request':
        if (seenAskIds.has(event.requestId)) break;
        seenAskIds.add(event.requestId);
        items.push({
          kind: 'question',
          id: event.requestId,
          turnId: currentTurnId,
          requestId: event.requestId,
          toolCall: event.toolCall,
          questions: event.questions,
          responding:
            !questionResolutions.has(event.requestId) &&
            promptResponseStatuses.get(event.requestId) === 'responding',
          resolution: questionResolutions.get(event.requestId),
          receivedAt,
        });
        questionIndex.set(event.requestId, items.length - 1);
        questionAsks.push(event.requestId);
        break;
      case 'prompt-response-status': {
        if (
          permissionResolutions.has(event.requestId) ||
          questionResolutions.has(event.requestId)
        ) {
          break;
        }
        promptResponseStatuses.set(event.requestId, event.status);
        const index = approvalIndex.get(event.requestId) ?? questionIndex.get(event.requestId);
        if (index !== undefined) {
          const item = items[index];
          if (item.kind === 'approval' || item.kind === 'question') {
            items[index] = {
              ...item,
              responding: event.status === 'responding',
              receivedAt: receivedAt ?? item.receivedAt,
            };
          }
        }
        break;
      }
      case 'permission-resolved': {
        if (permissionResolutions.has(event.requestId)) break;
        const resolution = { outcome: event.outcome, source: event.source };
        permissionResolutions.set(event.requestId, resolution);
        const index = approvalIndex.get(event.requestId);
        if (index !== undefined) {
          const item = items[index];
          if (item.kind === 'approval') {
            items[index] = {
              ...item,
              responding: false,
              resolution,
              receivedAt: receivedAt ?? item.receivedAt,
            };
          }
        }
        break;
      }
      case 'question-resolved': {
        if (questionResolutions.has(event.requestId)) break;
        const resolution = { outcome: event.outcome, source: event.source };
        questionResolutions.set(event.requestId, resolution);
        const index = questionIndex.get(event.requestId);
        if (index !== undefined) {
          const item = items[index];
          if (item.kind === 'question') {
            items[index] = {
              ...item,
              responding: false,
              resolution,
              receivedAt: receivedAt ?? item.receivedAt,
            };
          }
        }
        break;
      }
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

    cached = {
      items: out,
      status,
      usage,
      usageReport,
      currentModeId,
      approvalPolicy,
      currentModel,
      currentEffort,
      availableCommands,
      availableModels,
      capabilities,
      stopReason,
      pendingPermissionIds: approvals.filter((requestId) => !permissionResolutions.has(requestId)),
      pendingQuestionIds: questionAsks.filter((requestId) => !questionResolutions.has(requestId)),
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
