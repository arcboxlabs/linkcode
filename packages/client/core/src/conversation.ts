import type {
  AgentCapabilities,
  AgentCommand,
  AgentEvent,
  AgentModelOption,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  PermissionOption,
  PermissionSubject,
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
 * Conversation view-model: folds the daemon's flat, append-only `AgentEvent[]` into the structured
 * timeline the UI needs. `buildConversation` is a pure reducer, unit-testable without a transport.
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

/** A single semantic item in the conversation timeline. `receivedAt` is the best-known time of the
 * item's latest event: the client receive time for live events (see {@link SequencedAgentEvent}),
 * the provider's own timestamp for items reconstructed from a history read, absent when neither is
 * known. It drives the timestamps in the UI. */
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
      /** The model serving the session when this assistant message opened (from `model-update`). */
      model?: string;
    }
  | {
      kind: 'reasoning';
      id: string;
      turnId: ConversationTurnId;
      blocks: ContentBlock[];
      isStreaming: boolean;
      parentToolCallId?: string;
      /** Best-known time of the first chunk in this reasoning item. */
      startedAt?: number;
      /** Best-known time of the next semantic boundary in the same scope. */
      endedAt?: number;
      /** Reserved for a future provider-supplied summary; never derived from `blocks`. */
      summary?: string;
    }
  | { kind: 'tool'; id: string; turnId: ConversationTurnId; toolCall: ToolCall }
  | {
      kind: 'compaction';
      /** The provider's compaction boundary id — partial re-emits merge into one marker by it. */
      id: string;
      turnId: ConversationTurnId;
      /** Absent means completed; `in_progress` renders as a live "compacting…" row until the
       * provider's completed re-emit merges over it. */
      status?: 'in_progress' | 'completed';
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
      title?: string;
      description?: string;
      subject?: PermissionSubject;
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
  /** The model the session actually runs on, from `model-update`. `null` until the adapter
   * reports it — the composer then shows a placeholder rather than a guess. */
  currentModel: string | null;
  /** The reasoning-effort level the session is running at, from `effort-update`. `null` until the
   * adapter reports it — same placeholder rule as `currentModel`. */
  currentEffort: EffortLevel | null;
  /** Slash-command catalog from `available-commands-update` (full-replace). `null` means no
   * authoritative catalog has arrived yet; `[]` means the adapter advertised an empty catalog. */
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
  /** Fold one more event into the running state. `receivedAt` is the time to stamp on the item(s)
   * this event touches: the client receive time for live events, the provider's own event
   * timestamp for history-read replays (omitted when the provider recorded none). */
  advance(event: AgentEvent, receivedAt?: number): void;
  /** The current view-model. Cached between advances; every changed item is a fresh object
   * (copy-on-write), so React memoization over items keeps working across snapshots. */
  snapshot(): Conversation;
}

/**
 * Incremental form of {@link buildConversation}: advanced one event at a time (O(delta), not a full
 * re-reduce). Item updates are copy-on-write — previously returned snapshots are never mutated.
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
  /** parentToolCallId (undefined = main agent) → the reasoning item currently open in that scope. */
  const activeReasoningByScope = new Map<string | undefined, number>();
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
  let turnStopped = false;
  let cached: Conversation | null = null;

  const genId = (prefix: string): string => `${prefix}-${gen++}`;

  const endActiveReasoning = (scope: string | undefined, endedAt: number | undefined): void => {
    const index = activeReasoningByScope.get(scope);
    if (index === undefined) return;
    activeReasoningByScope.delete(scope);
    if (endedAt === undefined) return;
    const item = items[index];
    if (item.kind === 'reasoning' && item.endedAt === undefined) {
      items[index] = { ...item, endedAt };
    }
  };

  const endAllActiveReasoning = (endedAt: number | undefined): void => {
    for (const scope of activeReasoningByScope.keys()) {
      endActiveReasoning(scope, endedAt);
    }
  };

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
          // Backfill a model the adapter only reported after this message opened.
          ...(item.kind === 'message' && { model: item.model ?? currentModel ?? undefined }),
        };
        return;
      }
    }
    endActiveReasoning(parentToolCallId, receivedAt);
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
        model: currentModel ?? undefined,
      });
    } else {
      items.push({
        kind: 'reasoning',
        id: messageId,
        turnId: currentTurnId,
        blocks: [block],
        isStreaming: false,
        parentToolCallId,
        startedAt: receivedAt,
        receivedAt,
      });
      activeReasoningByScope.set(parentToolCallId, items.length - 1);
    }
    messageIndex.set(messageId, items.length - 1);
  };

  const advance = (event: AgentEvent, receivedAt?: number): void => {
    cached = null;
    switch (event.type) {
      case 'user-message': {
        // A complete, atomic message: opens a new turn and is pushed whole (never grouped/appended).
        endAllActiveReasoning(receivedAt);
        turnStopped = false;
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
          endActiveReasoning(event.toolCall.parentToolCallId, receivedAt);
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
      case 'tool-call-content-chunk': {
        const existing = toolIndex.get(event.toolCallId);
        if (existing === undefined) break;
        const item = items[existing];
        if (item.kind === 'tool') {
          items[existing] = {
            ...item,
            toolCall: {
              ...item.toolCall,
              content: [...item.toolCall.content, event.content],
            },
            receivedAt: receivedAt ?? item.receivedAt,
          };
        }
        break;
      }

      case 'compaction': {
        // The boundary arrives more than once (metadata first, summary later; history replay
        // repeats the compactionId) — merge, so a partial emit never wipes earlier fields.
        const existing = compactionIndex.get(event.compactionId);
        if (existing === undefined) {
          endActiveReasoning(undefined, receivedAt);
          items.push({
            kind: 'compaction',
            id: event.compactionId,
            turnId: currentTurnId,
            status: event.status,
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
            status: event.status ?? item.status,
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
          endActiveReasoning(undefined, receivedAt);
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
        if (event.status !== 'starting' && event.status !== 'running') {
          endAllActiveReasoning(receivedAt);
          turnStopped = true;
        } else {
          turnStopped = false;
        }
        status = event.status;
        break;
      case 'token-usage':
        usage = event.usage;
        break;
      case 'usage-report':
        usageReport = event.report;
        break;
      case 'stop':
        endAllActiveReasoning(receivedAt);
        turnStopped = true;
        stopReason = event.stopReason;
        break;

      case 'error':
        endActiveReasoning(undefined, receivedAt);
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

      case 'permission-request': {
        // The engine re-broadcasts open asks on session.attach; a duplicate must not add a card.
        if (seenAskIds.has(event.requestId)) break;
        seenAskIds.add(event.requestId);
        const subject = event.subject ?? {
          type: 'tool-call' as const,
          toolCallId: event.toolCall?.toolCallId ?? event.requestId,
        };
        const linkedIndex = subject.toolCallId ? toolIndex.get(subject.toolCallId) : undefined;
        const linkedItem = linkedIndex === undefined ? undefined : items[linkedIndex];
        const linkedToolCall = linkedItem?.kind === 'tool' ? linkedItem.toolCall : undefined;
        const title = event.title ?? event.toolCall?.title ?? event.requestId;
        const toolCall =
          linkedToolCall ??
          event.toolCall ??
          (subject.type === 'command'
            ? {
                toolCallId: subject.toolCallId ?? event.requestId,
                title,
                kind: 'execute' as const,
                rawInput: { command: subject.command, cwd: subject.cwd },
              }
            : { toolCallId: subject.toolCallId, title });
        endActiveReasoning(toolCall.parentToolCallId ?? undefined, receivedAt);
        items.push({
          kind: 'approval',
          id: event.requestId,
          turnId: currentTurnId,
          requestId: event.requestId,
          title,
          description: event.description,
          subject,
          toolCall,
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
      }
      case 'question-request':
        if (seenAskIds.has(event.requestId)) break;
        seenAskIds.add(event.requestId);
        endActiveReasoning(event.toolCall.parentToolCallId ?? undefined, receivedAt);
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
    const isSessionStreaming = !turnStopped && (status === 'running' || status === 'starting');
    if (isSessionStreaming) {
      for (const index of activeReasoningByScope.values()) {
        const reasoning = out[index];
        if (reasoning.kind === 'reasoning') out[index] = { ...reasoning, isStreaming: true };
      }
      const last = out.at(-1);
      if (last?.kind === 'message' && last.role === 'assistant') {
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

/** One seeded event with the provider's own timestamp (`AgentHistoryEvent.ts`), which stands in
 * for the receive time live events get — without it, every history-seeded item is dateless. */
export interface ConversationSeedEvent {
  event: AgentEvent;
  ts?: number;
}

/** A point-in-time transcript snapshot: past events read from provider history, plus the live
 * stream's receive counter sampled when the read resolved (see `LinkCodeClient.eventSeq`). The
 * conversation store folds the seed first, then the live events past the `uptoSeq` cut — and,
 * because a mid-turn transcript lags the stream, pre-cut events whose identity the snapshot
 * doesn't cover (an in-flight message's chunks, an unflushed tool call; CODE-272). */
export interface ConversationSeed {
  events: ConversationSeedEvent[];
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
