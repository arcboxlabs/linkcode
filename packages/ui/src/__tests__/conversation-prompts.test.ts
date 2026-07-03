import type { PermissionOption, Plan } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { PermissionConversationItem } from '../chat/conversation-prompts';
import {
  conversationFlowItems,
  declinedToolCall,
  declinedToolCallIds,
  isPermissionDeclined,
  resolvePermissionPageIndex,
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

  it('preserves and clamps the permission prompt page', () => {
    const first = approval('first');
    const second = approval('second');
    const third = approval('third');

    expect(
      resolvePermissionPageIndex([first, second, third], { requestId: 'second', index: 1 }),
    ).toBe(1);
    expect(resolvePermissionPageIndex([first, third], { requestId: 'second', index: 1 })).toBe(1);
    expect(resolvePermissionPageIndex([first], { requestId: 'third', index: 2 })).toBe(0);
  });

  it('collects only reject decisions as declined tool calls', () => {
    const items = [approval('allowed'), approval('rejected'), approval('unanswered')];
    const decisions = new Map<string, PermissionOption>([
      ['allowed', ALLOW],
      ['rejected', REJECT],
    ]);

    expect(isPermissionDeclined(ALLOW)).toBe(false);
    expect(isPermissionDeclined(undefined)).toBe(false);
    expect(declinedToolCallIds(items, decisions)).toEqual(new Set(['tool-rejected']));
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
});
