import type { PermissionOption, Plan } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  isConversationPromptResponseSubmittable,
  STUB_AGENT_QUESTION_PROMPTS,
  STUB_PLAN_REVIEW_PROMPTS,
} from '../chat/conversation-prompt';
import type { PermissionConversationItem, PermissionDecision } from '../chat/conversation-prompts';
import {
  conversationFlowItems,
  declinedToolCall,
  declinedToolCallIds,
  isPermissionDeclined,
  resolvePromptPageIndex,
  selectCurrentPlan,
  selectPendingPermissionItems,
} from '../chat/conversation-prompts';
import type { ConversationItem, ConversationViewModel } from '../chat/types';

const ALLOW = { optionId: 'allow', name: 'Allow', kind: 'allow_once' } satisfies PermissionOption;
const REJECT = {
  optionId: 'reject',
  name: 'Reject',
  kind: 'reject_once',
} satisfies PermissionOption;

function conversation(
  items: ConversationItem[],
  overrides: Partial<ConversationViewModel> = {},
): ConversationViewModel {
  return {
    items,
    status: 'running',
    usage: null,
    currentModeId: null,
    approvalPolicy: null,
    stopReason: null,
    pendingPermissionIds: [],
    ...overrides,
  };
}

function user(id: string): ConversationItem {
  return {
    kind: 'message',
    id,
    turnId: id,
    role: 'user',
    blocks: [],
    isStreaming: false,
  };
}

function plan(turnId: string, entries: Plan['entries']): ConversationItem {
  return {
    kind: 'plan',
    id: `plan-${turnId}`,
    turnId,
    plan: { entries },
  };
}

function approval(requestId: string): PermissionConversationItem {
  return {
    kind: 'approval',
    id: requestId,
    turnId: 'turn-0',
    requestId,
    toolCall: { toolCallId: `tool-${requestId}`, title: requestId },
    options: [],
  };
}

describe('conversation prompt selectors', () => {
  it('excludes plans from conversation flow items', () => {
    const message = user('turn-0');
    const item = plan('turn-0', [{ content: 'Read files', priority: 'high', status: 'pending' }]);

    expect(conversationFlowItems([message, item])).toEqual([message]);
  });

  it('selects in-progress, then pending, then completed plan task', () => {
    const current = selectCurrentPlan(
      conversation([
        user('turn-0'),
        plan('turn-0', [
          { content: 'Done', priority: 'high', status: 'completed' },
          { content: 'Now', priority: 'high', status: 'in_progress' },
          { content: 'Later', priority: 'medium', status: 'pending' },
        ]),
      ]),
    );
    const pending = selectCurrentPlan(
      conversation([
        user('turn-1'),
        plan('turn-1', [
          { content: 'Done', priority: 'high', status: 'completed' },
          { content: 'Next', priority: 'medium', status: 'pending' },
        ]),
      ]),
    );
    const complete = selectCurrentPlan(
      conversation([
        user('turn-2'),
        plan('turn-2', [
          { content: 'One', priority: 'high', status: 'completed' },
          { content: 'Two', priority: 'medium', status: 'completed' },
        ]),
      ]),
    );

    expect(current?.currentIndex).toBe(1);
    expect(pending?.currentIndex).toBe(1);
    expect(complete?.currentIndex).toBe(1);
    expect(complete?.complete).toBe(true);
  });

  it('keeps a completed plan until the next user turn', () => {
    const oldPlan = plan('turn-0', [{ content: 'Done', priority: 'high', status: 'completed' }]);

    expect(selectCurrentPlan(conversation([user('turn-0'), oldPlan]))).not.toBeNull();
    expect(selectCurrentPlan(conversation([user('turn-0'), oldPlan, user('turn-1')]))).toBeNull();
  });

  it('only surfaces pending permissions while a turn is live', () => {
    const item = approval('ask');
    const pending = { pendingPermissionIds: ['ask'] };

    expect(selectPendingPermissionItems(conversation([item], pending))).toEqual([item]);
    expect(
      selectPendingPermissionItems(conversation([item], { ...pending, status: 'idle' })),
    ).toEqual([]);
    expect(selectPendingPermissionItems(conversation([item]))).toEqual([]);
  });

  it('preserves and clamps the prompt page', () => {
    const first = { promptId: 'first' };
    const second = { promptId: 'second' };
    const third = { promptId: 'third' };

    expect(resolvePromptPageIndex([first, second, third], { promptId: 'second', index: 1 })).toBe(
      1,
    );
    expect(resolvePromptPageIndex([first, third], { promptId: 'second', index: 1 })).toBe(1);
    expect(resolvePromptPageIndex([first], { promptId: 'third', index: 2 })).toBe(0);
  });

  it('collects reject and cancelled decisions as declined tool calls', () => {
    const items = [
      approval('allowed'),
      approval('rejected'),
      approval('skipped'),
      approval('unanswered'),
    ];
    const decisions = new Map<string, PermissionDecision>([
      ['allowed', { outcome: 'selected', option: ALLOW }],
      ['rejected', { outcome: 'selected', option: REJECT }],
      ['skipped', { outcome: 'cancelled' }],
    ]);

    expect(isPermissionDeclined({ outcome: 'selected', option: ALLOW })).toBe(false);
    expect(isPermissionDeclined({ outcome: 'selected', option: REJECT })).toBe(true);
    expect(isPermissionDeclined({ outcome: 'cancelled' })).toBe(true);
    expect(isPermissionDeclined(undefined)).toBe(false);
    expect(declinedToolCallIds(items, decisions)).toEqual(
      new Set(['tool-rejected', 'tool-skipped']),
    );
  });

  it('materializes a failed tool call from a declined permission snapshot', () => {
    expect(declinedToolCall({ toolCallId: 'tc-1' })).toEqual({
      toolCallId: 'tc-1',
      title: 'tc-1',
      kind: 'other',
      status: 'failed',
      content: [],
      locations: undefined,
      rawInput: undefined,
      rawOutput: undefined,
    });
  });

  it('validates generic single and multiple prompt responses', () => {
    const choices = [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ];

    expect(
      isConversationPromptResponseSubmittable(
        { mode: 'single', choices },
        { selectedIds: ['yes'] },
      ),
    ).toBe(true);
    expect(
      isConversationPromptResponseSubmittable(
        { mode: 'single', choices },
        { selectedIds: ['yes', 'no'] },
      ),
    ).toBe(false);
    expect(
      isConversationPromptResponseSubmittable(
        { mode: 'multiple', choices },
        { selectedIds: ['yes', 'no'] },
      ),
    ).toBe(true);
    expect(
      isConversationPromptResponseSubmittable({ mode: 'multiple', choices }, { selectedIds: [] }),
    ).toBe(false);
  });

  it('validates inline custom prompt responses', () => {
    const choices = [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ];

    expect(
      isConversationPromptResponseSubmittable(
        { mode: 'single', choices },
        { selectedIds: [], customText: '' },
      ),
    ).toBe(false);
    expect(
      isConversationPromptResponseSubmittable(
        { mode: 'single', choices },
        { selectedIds: [], customText: 'Use a safer command' },
      ),
    ).toBe(true);
    expect(
      isConversationPromptResponseSubmittable(
        { mode: 'multiple', choices },
        { selectedIds: [], customText: 'Use a safer command' },
      ),
    ).toBe(true);
  });

  it('leaves future prompt stubs empty until the backend schema exists', () => {
    expect(STUB_AGENT_QUESTION_PROMPTS).toEqual([]);
    expect(STUB_PLAN_REVIEW_PROMPTS).toEqual([]);
  });
});
