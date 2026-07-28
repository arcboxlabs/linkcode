import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { ActivityGroupingPolicy } from '../chat/activity-groups';
import { groupTimeline } from '../chat/activity-groups';
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

function reasoning(): Extract<ConversationItem, { kind: 'reasoning' }> {
  return {
    kind: 'reasoning',
    id: `reasoning-${seq++}`,
    turnId: 'turn-0',
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

function boundary(
  kind: 'plan' | 'approval' | 'question' | 'error' | 'compaction',
): ConversationItem {
  const id = `boundary-${seq++}`;
  switch (kind) {
    case 'plan':
      return { kind, id, turnId: 'turn-0', plan: { planId: id, entries: [] } };
    case 'approval':
      return approvalFor(`unrelated-${id}`);
    case 'question':
      return {
        kind,
        id,
        turnId: 'turn-0',
        requestId: `request-${id}`,
        toolCall: { toolCallId: `tool-${id}`, title: id },
        questions: [],
        responding: false,
      };
    case 'error':
      return { kind, id, turnId: 'turn-0', message: 'failed', recoverable: false };
    case 'compaction':
      return { kind, id, turnId: 'turn-0', status: 'completed' };
    default:
      return kind satisfies never;
  }
}

const legacyGroupingPolicy: ActivityGroupingPolicy = {
  classify(item, context) {
    if (item.kind === 'reasoning') return null;
    if (item.kind !== 'tool' || item.toolCall.kind === 'task') return null;
    if (context.approvalGatedToolCallIds.has(item.toolCall.toolCallId)) return null;
    switch (item.toolCall.kind) {
      case 'read':
      case 'search':
        return 'explore';
      case 'execute':
        return 'command';
      case 'fetch':
        return 'fetch';
      case 'think':
        return 'think';
      case 'edit':
      case 'delete':
      case 'move':
        return 'files';
      case 'other':
        return 'other';
      default:
        return item.toolCall.kind satisfies never;
    }
  },
  minimumGroupSize: 2,
};

describe('groupTimeline', () => {
  it('collapses consecutive reasoning and cross-kind tools into one run', () => {
    const items = [
      reasoning(),
      tool('read'),
      tool('execute'),
      tool('edit'),
      tool('fetch'),
      tool('other'),
    ];
    const entries = groupTimeline(items);

    expect(entries).toEqual([{ type: 'run', id: `run-${items[0].id}`, items }]);
  });

  it('keeps a lone activity as an ordinary item entry', () => {
    const items = [tool('execute')];

    expect(groupTimeline(items)).toEqual([{ type: 'item', item: items[0] }]);
  });

  it.each(['user', 'assistant'] as const)('splits runs on %s messages', (role) => {
    const first = tool('read');
    const narration = message(role);
    const second = tool('execute');
    const third = reasoning();
    const entries = groupTimeline([first, narration, second, third]);

    expect(entries).toEqual([
      { type: 'item', item: first },
      { type: 'item', item: narration },
      { type: 'run', id: `run-${second.id}`, items: [second, third] },
    ]);
  });

  it.each([
    'plan',
    'approval',
    'question',
    'error',
    'compaction',
  ] as const)('flushes runs on %s items', (kind) => {
    const before = [reasoning(), tool('read')];
    const interrupt = boundary(kind);
    const after = [tool('execute'), tool('edit')];

    expect(groupTimeline([...before, interrupt, ...after])).toEqual([
      { type: 'run', id: `run-${before[0].id}`, items: before },
      { type: 'item', item: interrupt },
      { type: 'run', id: `run-${after[0].id}`, items: after },
    ]);
  });

  it('groups approval-gated tools by default until the approval event itself interrupts', () => {
    const guarded = tool('edit');
    const before = tool('read');
    const approval = approvalFor(guarded.toolCall.toolCallId);

    expect(groupTimeline([before, guarded, approval])).toEqual([
      { type: 'run', id: `run-${before.id}`, items: [before, guarded] },
      { type: 'item', item: approval },
    ]);
  });

  it('keeps task tools standalone and splits surrounding runs', () => {
    const before = [reasoning(), tool('read')];
    const task = tool('task');
    const after = [tool('execute'), tool('edit')];

    expect(groupTimeline([...before, task, ...after])).toEqual([
      { type: 'run', id: `run-${before[0].id}`, items: before },
      { type: 'item', item: task },
      { type: 'run', id: `run-${after[0].id}`, items: after },
    ]);
  });

  it('supports the legacy same-bucket policy through custom classification', () => {
    const explore = [tool('read'), tool('search')];
    const commands = [tool('execute'), tool('execute')];
    const fetches = [tool('fetch'), tool('fetch')];
    const thoughts = [tool('think'), tool('think')];
    const files = [tool('edit'), tool('move')];
    const others = [tool('other'), tool('other')];
    const standaloneReasoning = reasoning();
    const guarded = tool('read');
    const approval = approvalFor(guarded.toolCall.toolCallId);
    const task = tool('task');

    expect(
      groupTimeline(
        [
          ...explore,
          ...commands,
          ...fetches,
          ...thoughts,
          ...files,
          ...others,
          standaloneReasoning,
          guarded,
          approval,
          task,
        ],
        legacyGroupingPolicy,
      ),
    ).toEqual([
      { type: 'run', id: `run-${explore[0].id}`, items: explore },
      { type: 'run', id: `run-${commands[0].id}`, items: commands },
      { type: 'run', id: `run-${fetches[0].id}`, items: fetches },
      { type: 'run', id: `run-${thoughts[0].id}`, items: thoughts },
      { type: 'run', id: `run-${files[0].id}`, items: files },
      { type: 'run', id: `run-${others[0].id}`, items: others },
      { type: 'item', item: standaloneReasoning },
      { type: 'item', item: guarded },
      { type: 'item', item: approval },
      { type: 'item', item: task },
    ]);
  });

  it('honors a custom minimum group size', () => {
    const items = [tool('read'), tool('execute'), reasoning()];
    const policy: ActivityGroupingPolicy = {
      classify: (item) => (item.kind === 'reasoning' || item.kind === 'tool' ? 'activity' : null),
      minimumGroupSize: 3,
    };

    expect(groupTimeline(items.slice(0, 2), policy)).toEqual(
      items.slice(0, 2).map((item) => ({ type: 'item', item })),
    );
    expect(groupTimeline(items, policy)).toEqual([
      { type: 'run', id: `run-${items[0].id}`, items },
    ]);
  });

  it('keeps run ids stable while a streaming burst appends items', () => {
    const first = tool('execute');
    const second = reasoning();
    const third = tool('edit');

    const [beforeRun] = groupTimeline([first, second]);
    const [afterRun] = groupTimeline([first, second, third]);
    if (beforeRun.type !== 'run' || afterRun.type !== 'run') {
      throw new Error('expected runs');
    }

    expect(afterRun.id).toBe(beforeRun.id);
  });
});
