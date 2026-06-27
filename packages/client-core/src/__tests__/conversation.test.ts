import type { AgentEvent, MessageId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { buildConversation, contentPreview, toolCallDiffs } from '../conversation';

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

  it('coalesces same-messageId text chunks into one streaming block', () => {
    const c = buildConversation([text('Hel'), text('lo, '), text('world')]);
    expect(c.items).toHaveLength(1);
    const item = c.items[0];
    expect(item.kind).toBe('assistant-message');
    if (item.kind === 'assistant-message') {
      expect(item.blocks).toHaveLength(1);
      expect(item.blocks[0]).toEqual({ type: 'text', text: 'Hello, world' });
    }
  });

  it('separates user and assistant turns; distinct messageIds make distinct bubbles', () => {
    const c = buildConversation([
      userText('do it'),
      text('working', 'm1'),
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
      text('done', 'm2'),
    ]);
    expect(c.items.map((i) => i.kind)).toEqual([
      'user-message',
      'assistant-message',
      'tool-call',
      'assistant-message',
    ]);
  });

  it('buckets streaming chunks by messageId across an interleaved tool call', () => {
    const c = buildConversation([
      text('Let me check ', 'm1'),
      {
        type: 'tool-call',
        toolCall: { toolCallId: 't1', title: 'Read', kind: 'read', status: 'completed', content: [] },
      },
      text('the file.', 'm1'),
    ]);
    // The second 'm1' chunk merges into the existing bubble, which stays ahead of the tool call.
    expect(c.items.map((i) => i.kind)).toEqual(['assistant-message', 'tool-call']);
    const msg = c.items[0];
    if (msg.kind === 'assistant-message') {
      expect(msg.blocks).toEqual([{ type: 'text', text: 'Let me check the file.' }]);
    }
  });

  it('renders a user-message whole from its content array', () => {
    const c = buildConversation([
      {
        type: 'user-message',
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', data: 'x', mimeType: 'image/png' },
        ],
      },
    ]);
    expect(c.items).toHaveLength(1);
    const item = c.items[0];
    expect(item.kind).toBe('user-message');
    if (item.kind === 'user-message') expect(item.blocks).toHaveLength(2);
  });

  it('replaces a tool call by id with the latest full snapshot', () => {
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
    expect(item.kind).toBe('tool-call');
    if (item.kind === 'tool-call') {
      expect(item.toolCall.status).toBe('completed');
      expect(item.toolCall.title).toBe('Edit');
      expect(toolCallDiffs(item.toolCall)).toHaveLength(1);
    }
  });

  it('keeps only the latest plan as a single item', () => {
    const c = buildConversation([
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
    ]);
    const plans = c.items.filter((i) => i.kind === 'plan');
    expect(plans).toHaveLength(1);
    expect(plans[0].plan.entries).toHaveLength(2);
  });

  it('tracks a permission as pending until its tool call settles', () => {
    const base: AgentEvent[] = [
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
