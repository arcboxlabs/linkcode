import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { activityBucket, groupTimeline } from '../chat/activity-groups';
import type { ConversationItem } from '../chat/types';

let seq = 0;

function tool(
  kind: ToolCall['kind'],
  overrides: Partial<ToolCall> = {},
): Extract<ConversationItem, { kind: 'tool' }> {
  const id = `tool-${seq++}`;
  return {
    kind: 'tool',
    id,
    turnId: 'turn-0',
    toolCall: {
      toolCallId: id,
      title: `${kind} ${id}`,
      kind,
      status: 'completed',
      content: [],
      ...overrides,
    },
  };
}

function message(role: 'user' | 'assistant'): ConversationItem {
  return {
    kind: 'message',
    id: `msg-${seq++}`,
    turnId: 'turn-0',
    role,
    blocks: [],
    isStreaming: false,
  };
}

function approvalFor(toolCallId: string): ConversationItem {
  return {
    kind: 'approval',
    id: `approval-${seq++}`,
    turnId: 'turn-0',
    requestId: `req-${seq}`,
    toolCall: { toolCallId },
    options: [],
    responding: false,
  };
}

describe('activityBucket', () => {
  it('buckets kinds by review affordance', () => {
    expect(activityBucket('read')).toBe('explore');
    expect(activityBucket('search')).toBe('explore');
    expect(activityBucket('execute')).toBe('command');
    expect(activityBucket('fetch')).toBe('fetch');
    expect(activityBucket('think')).toBe('think');
    expect(activityBucket('edit')).toBe('files');
    expect(activityBucket('delete')).toBe('files');
    expect(activityBucket('move')).toBe('files');
    expect(activityBucket('other')).toBe('other');
  });
});

describe('groupTimeline', () => {
  it('collapses a same-bucket streak of 2+ into a group', () => {
    const items = [tool('read'), tool('search'), tool('read')];
    const entries = groupTimeline(items);

    expect(entries).toEqual([
      { type: 'group', id: `group-${items[0].id}`, bucket: 'explore', items },
    ]);
  });

  it('keeps a lone call as a single', () => {
    const items = [tool('execute')];

    expect(groupTimeline(items)).toEqual([{ type: 'single', item: items[0] }]);
  });

  it('splits streaks when the bucket changes', () => {
    const items = [tool('read'), tool('search'), tool('execute'), tool('execute'), tool('edit')];
    const entries = groupTimeline(items);

    expect(entries.map((entry) => entry.type)).toEqual(['group', 'group', 'single']);
    const [explore, command] = entries;
    if (explore.type !== 'group' || command.type !== 'group') throw new Error('expected groups');
    expect(explore.bucket).toBe('explore');
    expect(explore.items).toHaveLength(2);
    expect(command.bucket).toBe('command');
    expect(command.items).toHaveLength(2);
  });

  it('flushes streaks on non-tool items', () => {
    const first = tool('read');
    const narration = message('assistant');
    const second = tool('read');
    const entries = groupTimeline([first, narration, second]);

    expect(entries).toEqual([
      { type: 'single', item: first },
      { type: 'item', item: narration },
      { type: 'single', item: second },
    ]);
  });

  it('keeps approval-gated calls out of groups', () => {
    const guarded = tool('edit');
    const items = [tool('edit'), guarded, tool('edit'), approvalFor(guarded.toolCall.toolCallId)];
    const entries = groupTimeline(items);

    expect(entries.map((entry) => entry.type)).toEqual(['single', 'single', 'single', 'item']);
    expect(entries[1]).toEqual({ type: 'single', item: guarded });
  });

  it('keeps group ids stable while a streaming burst appends items', () => {
    const first = tool('execute');
    const second = tool('execute');
    const third = tool('execute');

    const [beforeGroup] = groupTimeline([first, second]);
    const [afterGroup] = groupTimeline([first, second, third]);
    if (beforeGroup.type !== 'group' || afterGroup.type !== 'group') {
      throw new Error('expected groups');
    }

    expect(afterGroup.id).toBe(beforeGroup.id);
  });
});
