import type { PermissionOption, Plan } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { PermissionConversationItem } from '../chat/conversation-prompts';
import {
  conversationFlowItems,
  declinedToolCall,
  declinedToolCallIds,
  selectCurrentPlan,
  selectPendingPromptItems,
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
    currentModel: null,
    currentEffort: null,
    availableCommands: null,
    capabilities: null,
    stopReason: null,
    pendingPermissionIds: [],
    pendingQuestionIds: [],
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
    responding: false,
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

  it('only surfaces pending prompt groups while a turn is live', () => {
    const item = approval('ask');
    const pending = { pendingPermissionIds: ['ask'] };

    expect(selectPendingPromptItems(conversation([item], pending))).toEqual([item]);
    expect(selectPendingPromptItems(conversation([item], { ...pending, status: 'idle' }))).toEqual(
      [],
    );
    expect(selectPendingPromptItems(conversation([item]))).toEqual([]);
  });

  it('collects authoritative reject and cancelled resolutions as declined tool calls', () => {
    const items = [
      {
        ...approval('allowed'),
        options: [ALLOW],
        resolution: {
          outcome: { outcome: 'selected' as const, optionId: ALLOW.optionId },
          source: 'user' as const,
        },
      },
      {
        ...approval('rejected'),
        options: [REJECT],
        resolution: {
          outcome: { outcome: 'selected' as const, optionId: REJECT.optionId },
          source: 'user' as const,
        },
      },
      {
        ...approval('cancelled'),
        resolution: { outcome: { outcome: 'cancelled' as const }, source: 'user' as const },
      },
      {
        ...approval('teardown'),
        resolution: { outcome: { outcome: 'cancelled' as const }, source: 'session' as const },
      },
      approval('unanswered'),
    ];

    expect(declinedToolCallIds(items)).toEqual(new Set(['tool-rejected', 'tool-cancelled']));
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

  it('selects pending question items only while the turn is live', () => {
    const question: ConversationItem = {
      kind: 'question',
      id: 'ask1',
      turnId: 'turn-1',
      requestId: 'ask1',
      toolCall: { toolCallId: 't1', title: 'AskUserQuestion' },
      responding: false,
      questions: [
        {
          questionId: 'q0',
          prompt: 'Which one?',
          multiSelect: false,
          options: [
            { optionId: 'o0', label: 'A' },
            { optionId: 'o1', label: 'B' },
          ],
        },
      ],
    };
    const permission = approval('ask2');
    const live = conversation([question, permission], {
      pendingPermissionIds: ['ask2'],
      pendingQuestionIds: ['ask1'],
    });
    expect(selectPendingPromptItems(live)).toEqual([question, permission]);

    const settled = conversation([question], { pendingQuestionIds: [] });
    expect(selectPendingPromptItems(settled)).toHaveLength(0);

    const ended = conversation([question], {
      pendingQuestionIds: ['ask1'],
      status: 'idle',
    });
    expect(selectPendingPromptItems(ended)).toHaveLength(0);
  });
});
