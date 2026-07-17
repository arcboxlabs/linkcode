import type { PermissionOption, ToolCall, ToolCallUpdate } from '@linkcode/schema';
import type { ConversationItem, ConversationViewModel } from './types';

export type PlanConversationItem = Extract<ConversationItem, { kind: 'plan' }>;
export type PermissionConversationItem = Extract<ConversationItem, { kind: 'approval' }>;
export type QuestionConversationItem = Extract<ConversationItem, { kind: 'question' }>;
export type PromptConversationItem = PermissionConversationItem | QuestionConversationItem;

export type PermissionDecision =
  | {
      outcome: 'selected';
      option: PermissionOption;
    }
  | { outcome: 'cancelled' };

export interface CurrentPlan {
  item: PlanConversationItem;
  currentIndex: number;
  total: number;
  complete: boolean;
}

export function conversationFlowItems(
  items: readonly ConversationItem[],
): Array<Exclude<ConversationItem, PlanConversationItem>> {
  return items.filter((item) => item.kind !== 'plan');
}

export function selectCurrentPlan(
  conversation: Pick<ConversationViewModel, 'items'>,
): CurrentPlan | null {
  const turnId = latestUserTurnId(conversation.items);
  const plan = conversation.items.findLast(
    (item): item is PlanConversationItem => item.kind === 'plan' && item.turnId === turnId,
  );
  if (!plan || plan.plan.entries.length === 0) return null;

  const inProgress = plan.plan.entries.findIndex((entry) => entry.status === 'in_progress');
  const pending = plan.plan.entries.findIndex((entry) => entry.status === 'pending');
  const currentIndex =
    inProgress >= 0 ? inProgress : pending >= 0 ? pending : plan.plan.entries.length - 1;

  return {
    item: plan,
    currentIndex,
    total: plan.plan.entries.length,
    complete: plan.plan.entries.every((entry) => entry.status === 'completed'),
  };
}

/** Pending actionable asks in conversation arrival order. Once the turn ends the agent is no
 * longer awaiting, so stale asks must not present an actionable card. */
export function selectPendingPromptItems(
  conversation: Pick<
    ConversationViewModel,
    'items' | 'pendingPermissionIds' | 'pendingQuestionIds' | 'status'
  >,
): PromptConversationItem[] {
  if (conversation.status !== 'running' && conversation.status !== 'starting') return [];
  const pendingPermissions = new Set(conversation.pendingPermissionIds);
  const pendingQuestions = new Set(conversation.pendingQuestionIds);
  return conversation.items.filter(
    (item): item is PromptConversationItem =>
      (item.kind === 'approval' && pendingPermissions.has(item.requestId)) ||
      (item.kind === 'question' && pendingQuestions.has(item.requestId)),
  );
}

/** toolCallIds whose authoritative permission resolution declined the gated action. */
export function declinedToolCallIds(items: readonly ConversationItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'approval') continue;
    if (!item.resolution) continue;
    const outcome = item.resolution.outcome;
    if (outcome.outcome === 'cancelled') {
      if (item.resolution.source === 'user') ids.add(item.toolCall.toolCallId);
      continue;
    }
    const option = item.options.find((candidate) => candidate.optionId === outcome.optionId);
    if (option?.kind === 'reject_once' || option?.kind === 'reject_always') {
      ids.add(item.toolCall.toolCallId);
    }
  }
  return ids;
}

/** Tool-call snapshot for a declined permission the agent never emitted a `tool-call` event for
 * (defaults mirror the adapter's `emitTool` synthesis). */
export function declinedToolCall(update: ToolCallUpdate): ToolCall {
  return {
    toolCallId: update.toolCallId,
    title: update.title ?? update.toolCallId,
    kind: update.kind ?? 'other',
    status: 'failed',
    content: update.content ?? [],
    locations: update.locations,
    rawInput: update.rawInput,
    rawOutput: update.rawOutput,
  };
}

function latestUserTurnId(items: readonly ConversationItem[]): ConversationItem['turnId'] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === 'message' && item.role === 'user') return item.turnId;
  }
  return null;
}
