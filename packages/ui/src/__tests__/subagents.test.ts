import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { groupTimeline } from '../chat/activity-groups';
import { partitionSubagentItems } from '../chat/subagents';
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

function narration(parentToolCallId?: string): ConversationItem {
  return {
    kind: 'message',
    id: `msg-${seq++}`,
    turnId: 'turn-0',
    role: 'assistant',
    blocks: [{ type: 'text', text: 'hi' }],
    isStreaming: false,
    parentToolCallId,
  };
}

describe('partitionSubagentItems', () => {
  it('splits children out of the timeline, grouped by parent in arrival order', () => {
    const task = tool('task');
    const taskId = task.toolCall.toolCallId;
    const childText = narration(taskId);
    const childTool = tool('read', { parentToolCallId: taskId });
    const mainText = narration();
    const { topLevel, childrenByParent } = partitionSubagentItems([
      task,
      childText,
      mainText,
      childTool,
    ]);

    expect(topLevel).toEqual([task, mainText]);
    expect(childrenByParent.get(taskId)).toEqual([childText, childTool]);
  });

  it('falls back to top-level for orphans whose parent is not in the slice', () => {
    const orphanText = narration('toolu_gone');
    const orphanTool = tool('read', { parentToolCallId: 'toolu_gone' });
    const { topLevel, childrenByParent } = partitionSubagentItems([orphanText, orphanTool]);

    expect(topLevel).toEqual([orphanText, orphanTool]);
    expect(childrenByParent.size).toBe(0);
  });
});

describe('groupTimeline task entries', () => {
  it('breaks a task tool out as its own entry, never in a streak', () => {
    const before = tool('read');
    const task = tool('task');
    const after = tool('read');
    const entries = groupTimeline([before, task, after]);

    expect(entries).toEqual([
      { type: 'single', item: before },
      { type: 'task', item: task },
      { type: 'single', item: after },
    ]);
  });
});
