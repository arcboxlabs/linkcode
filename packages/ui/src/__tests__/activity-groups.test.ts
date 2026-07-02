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

    expect(entries).toHaveLength(1);
    const run = entries[0];
    if (run.type !== 'activity') throw new Error('expected activity run');
    expect(run.entries).toEqual([
      { type: 'group', id: `group-${items[0].id}`, bucket: 'explore', items },
    ]);
  });

  it('keeps a lone call as a single', () => {
    const items = [tool('execute')];
    const entries = groupTimeline(items);

    expect(entries).toEqual([
      { type: 'activity', id: `run-${items[0].id}`, entries: [{ type: 'single', item: items[0] }] },
    ]);
  });

  it('splits streaks when the bucket changes', () => {
    const items = [tool('read'), tool('search'), tool('execute'), tool('execute'), tool('edit')];
    const [run] = groupTimeline(items);

    if (run.type !== 'activity') throw new Error('expected activity run');
    expect(run.entries.map((entry) => entry.type)).toEqual(['group', 'group', 'single']);
    const [explore, command] = run.entries;
    if (explore.type !== 'group' || command.type !== 'group') throw new Error('expected groups');
    expect(explore.bucket).toBe('explore');
    expect(explore.items).toHaveLength(2);
    expect(command.bucket).toBe('command');
    expect(command.items).toHaveLength(2);
  });

  it('flushes the run on non-tool items', () => {
    const first = tool('read');
    const second = tool('read');
    const entries = groupTimeline([first, message('assistant'), second]);

    expect(entries.map((entry) => entry.type)).toEqual(['activity', 'item', 'activity']);
    const [before, , after] = entries;
    if (before.type !== 'activity' || after.type !== 'activity') throw new Error('expected runs');
    expect(before.entries).toEqual([{ type: 'single', item: first }]);
    expect(after.entries).toEqual([{ type: 'single', item: second }]);
  });

  it('keeps approval-gated calls out of groups but inside the run', () => {
    const guarded = tool('edit');
    const items = [tool('edit'), guarded, tool('edit'), approvalFor(guarded.toolCall.toolCallId)];
    const entries = groupTimeline(items);

    expect(entries.map((entry) => entry.type)).toEqual(['activity', 'item']);
    const [run] = entries;
    if (run.type !== 'activity') throw new Error('expected activity run');
    expect(run.entries.map((entry) => entry.type)).toEqual(['single', 'single', 'single']);
    expect(run.entries[1]).toEqual({ type: 'single', item: guarded });
  });

  it('keeps group ids stable while a streaming burst appends items', () => {
    const first = tool('execute');
    const second = tool('execute');
    const third = tool('execute');

    const before = groupTimeline([first, second]);
    const after = groupTimeline([first, second, third]);
    if (before[0].type !== 'activity' || after[0].type !== 'activity') {
      throw new Error('expected activity runs');
    }
    const beforeGroup = before[0].entries[0];
    const afterGroup = after[0].entries[0];
    if (beforeGroup.type !== 'group' || afterGroup.type !== 'group') {
      throw new Error('expected groups');
    }

    expect(afterGroup.id).toBe(beforeGroup.id);
    expect(after[0].id).toBe(before[0].id);
  });
});
