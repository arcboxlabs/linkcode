import type { AgentEvent, MessageId } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import {
  buildConversation,
  contentPreview,
  mergeSeededEvents,
  toolCallDiffs,
} from '../conversation';

function text(t: string, messageId = 'm1'): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text: t },
  };
}
function userText(t: string): AgentEvent {
  return {
    type: 'user-message',
    content: [{ type: 'text', text: t }],
  };
}

describe('buildConversation', () => {
  it('returns an empty conversation for no events', () => {
    const c = buildConversation([]);
    expect(c.items).toEqual([]);
    expect(c.status).toBeNull();
    expect(c.usage).toBeNull();
    expect(c.pendingPermissionIds).toEqual([]);
  });

  it('coalesces same-messageId agent chunks into one streaming block', () => {
    const c = buildConversation([
      { type: 'status', status: 'running' },
      text('Hel'),
      text('lo, '),
      text('world'),
    ]);
    expect(c.items).toHaveLength(1);
    const item = c.items[0];
    expect(item.kind).toBe('message');
    if (item.kind === 'message') {
      expect(item.role).toBe('assistant');
      expect(item.turnId).toBeNull();
      expect(item.isStreaming).toBe(true);
      expect(item.blocks).toHaveLength(1);
      expect(item.blocks[0]).toEqual({ type: 'text', text: 'Hello, world' });
    }
  });

  it('separates user and assistant messages while keeping a turn id across activity', () => {
    const c = buildConversation([
      userText('do it'),
      text('working', 'a1'),
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Read file',
          kind: 'read',
          status: 'in_progress',
          content: [],
        },
      },
      // A new messageId opens a fresh assistant bubble after the tool call.
      text('done', 'a2'),
    ]);
    expect(c.items.map((i) => i.kind)).toEqual(['message', 'message', 'tool', 'message']);
    const [user, assistant, tool, followup] = c.items;
    if (
      user.kind === 'message' &&
      assistant.kind === 'message' &&
      tool.kind === 'tool' &&
      followup.kind === 'message'
    ) {
      expect(user.role).toBe('user');
      expect(assistant.role).toBe('assistant');
      expect(followup.role).toBe('assistant');
      expect(user.turnId).toBeTruthy();
      expect(assistant.turnId).toBe(user.turnId);
      expect(tool.turnId).toBe(user.turnId);
      expect(followup.turnId).toBe(user.turnId);
    }
  });

  it('projects thought chunks as reasoning and marks active reasoning as streaming', () => {
    const c = buildConversation([
      userText('think'),
      { type: 'status', status: 'running' },
      {
        type: 'agent-thought-chunk',
        messageId: 'th1' as MessageId,
        content: { type: 'text', text: 'step 1' },
      },
      {
        type: 'agent-thought-chunk',
        messageId: 'th1' as MessageId,
        content: { type: 'text', text: ' step 2' },
      },
    ]);
    const reasoning = c.items.at(-1);
    const first = c.items[0];
    expect(reasoning?.kind).toBe('reasoning');
    if (reasoning?.kind === 'reasoning' && first.kind === 'message') {
      expect(reasoning.blocks).toEqual([{ type: 'text', text: 'step 1 step 2' }]);
      expect(reasoning.isStreaming).toBe(true);
      expect(reasoning.turnId).toBe(first.turnId);
    }
  });

  it('replaces a tool call by id with each full snapshot', () => {
    const c = buildConversation([
      {
        type: 'tool-call',
        toolCall: { toolCallId: 't1', title: 'Edit', kind: 'edit', status: 'pending', content: [] },
      },
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Edit',
          kind: 'edit',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Edit',
          kind: 'edit',
          status: 'completed',
          content: [{ type: 'diff', path: '/a.ts', oldText: 'a', newText: 'b' }],
        },
      },
    ]);
    expect(c.items).toHaveLength(1);
    const item = c.items[0];
    expect(item.kind).toBe('tool');
    if (item.kind === 'tool') {
      expect(item.toolCall.status).toBe('completed');
      expect(item.toolCall.title).toBe('Edit');
      expect(toolCallDiffs(item.toolCall)).toHaveLength(1);
    }
  });

  it('keeps only the latest plan per turn', () => {
    const c = buildConversation([
      userText('first'),
      { type: 'plan', plan: { entries: [{ content: 'a', priority: 'high', status: 'pending' }] } },
      {
        type: 'plan',
        plan: {
          entries: [
            { content: 'a', priority: 'high', status: 'completed' },
            { content: 'b', priority: 'low', status: 'pending' },
          ],
        },
      },
      userText('second'),
      {
        type: 'plan',
        plan: { entries: [{ content: 'c', priority: 'medium', status: 'pending' }] },
      },
    ]);
    const plans = c.items.filter((i) => i.kind === 'plan');
    expect(plans).toHaveLength(2);
    const firstPlan = nullthrow(plans[0]);
    const secondPlan = nullthrow(plans[1]);
    expect(firstPlan.plan.entries).toHaveLength(2);
    expect(firstPlan.plan.entries[0]?.status).toBe('completed');
    expect(secondPlan.plan.entries).toHaveLength(1);
    expect(firstPlan.turnId).not.toBe(secondPlan.turnId);
  });

  it('tracks a permission as pending until its tool call settles', () => {
    const base: AgentEvent[] = [
      userText('run'),
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Run',
          kind: 'execute',
          status: 'pending',
          content: [],
        },
      },
      {
        type: 'permission-request',
        requestId: 'p1',
        toolCall: { toolCallId: 't1', title: 'Run' },
        options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
      },
    ];
    expect(buildConversation(base).pendingPermissionIds).toEqual(['p1']);
    expect(buildConversation(base).items.some((i) => i.kind === 'approval')).toBe(true);

    const settled = buildConversation([
      ...base,
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Run',
          kind: 'execute',
          status: 'completed',
          content: [],
        },
      },
    ]);
    expect(settled.pendingPermissionIds).toEqual([]);
  });

  it('a permission-resolved event settles the ask even while its tool call is still running', () => {
    const c = buildConversation([
      userText('run'),
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Run',
          kind: 'execute',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'permission-request',
        requestId: 'p1',
        toolCall: { toolCallId: 't1', title: 'Run' },
        options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
      },
      {
        type: 'permission-resolved',
        requestId: 'p1',
        outcome: { outcome: 'selected', optionId: 'ok' },
      },
    ]);
    expect(c.pendingPermissionIds).toEqual([]);
    const approval = c.items.find((i) => i.kind === 'approval');
    expect(approval?.kind === 'approval' && approval.resolution).toEqual({
      outcome: 'selected',
      optionId: 'ok',
    });
  });

  it('ignores a permission-resolved event with no matching ask', () => {
    const c = buildConversation([
      { type: 'permission-resolved', requestId: 'ghost', outcome: { outcome: 'cancelled' } },
    ]);
    expect(c.items).toEqual([]);
    expect(c.pendingPermissionIds).toEqual([]);
  });

  it('captures lifecycle state (status / usage / mode / stop / error)', () => {
    const c = buildConversation([
      { type: 'status', status: 'running' },
      { type: 'current-mode-update', currentModeId: 'plan' },
      { type: 'token-usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'error', message: 'boom', recoverable: true },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    expect(c.status).toBe('running');
    expect(c.currentModeId).toBe('plan');
    expect(c.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(c.stopReason).toBe('end_turn');
    expect(c.items.filter((i) => i.kind === 'error')).toHaveLength(1);
    const error = c.items.find((i) => i.kind === 'error');
    expect(error?.turnId).toBeNull();
  });
});

describe('mergeSeededEvents', () => {
  it('passes the live stream through when there is no seed', () => {
    const events = mergeSeededEvents(undefined, [
      { event: userText('hi'), seq: 1 },
      { event: text('yo'), seq: 2 },
    ]);
    expect(events).toEqual([userText('hi'), text('yo')]);
  });

  it('drops live events at or before the snapshot cut and keeps the tail', () => {
    const seed = { events: [userText('old prompt'), text('old reply')], uptoSeq: 2 };
    const events = mergeSeededEvents(seed, [
      { event: userText('duplicate of transcript'), seq: 1 },
      { event: userText('boundary'), seq: 2 },
      { event: userText('new prompt'), seq: 3 },
      { event: text('new reply', 'm2'), seq: 4 },
    ]);
    expect(events).toEqual([
      userText('old prompt'),
      text('old reply'),
      userText('new prompt'),
      text('new reply', 'm2'),
    ]);
  });

  it('keeps the seed intact when there are no live events', () => {
    const seed = { events: [userText('only history')], uptoSeq: 0 };
    expect(mergeSeededEvents(seed, [])).toEqual([userText('only history')]);
  });
});

describe('contentPreview', () => {
  it('joins text and tags non-text blocks', () => {
    expect(
      contentPreview([
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'x', mimeType: 'image/png' },
      ]),
    ).toBe('hello [image]');
  });
});
