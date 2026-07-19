import type { AgentEvent, MessageId, ToolCall } from '@linkcode/schema';
import { createFixedArray } from 'foxts/create-fixed-array';
import { describe, expect, it } from 'vitest';
import { capLines, contentBlockToMarkdown, fence } from '../blocks';
import { renderAgentEvents, renderItem, renderTurns } from '../render';

function chunk(text: string, messageId = 'm1'): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text },
  };
}

function thought(text: string, messageId = 'th1'): AgentEvent {
  return {
    type: 'agent-thought-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text },
  };
}

function userText(text: string): AgentEvent {
  return { type: 'user-message', content: [{ type: 'text', text }] };
}

function tool(overrides: Partial<ToolCall>): AgentEvent {
  return {
    type: 'tool-call',
    toolCall: {
      toolCallId: 't1',
      title: 'Read config.ts',
      kind: 'read',
      status: 'completed',
      content: [],
      ...overrides,
    },
  };
}

describe('content blocks', () => {
  it('degrades non-text blocks to labeled lines, never bare tags', () => {
    expect(contentBlockToMarkdown({ type: 'image', data: 'aGk=', mimeType: 'image/png' })).toBe(
      '🖼\u{FE0F} *image (image/png)*',
    );
    expect(
      contentBlockToMarkdown({ type: 'resource_link', uri: 'file:///a.ts', name: 'a.ts' }),
    ).toBe('📎 [a.ts](file:///a.ts)');
    expect(
      contentBlockToMarkdown({
        type: 'resource',
        resource: { uri: 'file:///b.txt', text: 'hello' },
      }),
    ).toBe('```\nhello\n```');
  });

  it('fences with a marker longer than any backtick run in the content', () => {
    expect(fence('code with ```` inside')).toBe('`````\ncode with ```` inside\n`````');
  });

  it('caps lines with an elision note', () => {
    expect(capLines('a\nb\nc\nd', 2)).toBe('a\nb\n… (+2 more lines)');
    expect(capLines('a\nb', 5)).toBe('a\nb');
  });
});

describe('renderAgentEvents', () => {
  it('merges streaming chunks and renders a full turn as readable markdown', () => {
    const markdown = renderAgentEvents([
      userText('rename foo to bar'),
      thought('I should ', 'th1'),
      thought('grep first.', 'th1'),
      chunk('Working on it. ', 'a1'),
      chunk('Done.', 'a1'),
    ]);
    expect(markdown).toBe('👤 rename foo to bar\n\n> I should grep first.\n\nWorking on it. Done.');
  });

  it('renders tool calls with diff and terminal content', () => {
    const markdown = renderAgentEvents([
      userText('edit it'),
      tool({
        title: 'Edit config.ts',
        kind: 'edit',
        status: 'completed',
        content: [
          { type: 'diff', path: 'src/config.ts', oldText: 'a\nb\n', newText: 'a\nc\n' },
          { type: 'terminal', terminalId: 'term-1' },
        ],
      }),
    ]);
    expect(markdown).toContain('✅ *Edit config.ts*');
    expect(markdown).toContain('✏\u{FE0F} `src/config.ts`');
    expect(markdown).toContain('```diff\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n```');
    expect(markdown).toContain('🖥\u{FE0F} *terminal session*');
  });

  it('renders plan, permission, and error items', () => {
    const markdown = renderAgentEvents([
      userText('plan it'),
      {
        type: 'plan',
        plan: {
          entries: [
            { content: 'read code', priority: 'high', status: 'completed' },
            { content: 'edit code', priority: 'high', status: 'in_progress' },
            { content: 'run tests', priority: 'medium', status: 'pending' },
          ],
        },
      },
      {
        type: 'permission-request',
        requestId: 'req-1',
        toolCall: { toolCallId: 't9', title: 'Run pnpm test' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
      { type: 'error', message: 'adapter crashed', code: 'E_ADAPTER', recoverable: true },
    ]);
    expect(markdown).toContain('📋 **Plan**\n● read code\n◐ edit code\n○ run tests');
    expect(markdown).toContain('🔐 **Permission required** — Run pnpm test\n• Allow\n• Reject');
    expect(markdown).toContain('⚠\u{FE0F} **Error:** adapter crashed (E_ADAPTER)');
  });

  it('truncates long tool output when maxCodeBlockLines is set', () => {
    const long = createFixedArray(10)
      .map((i) => `line ${i}`)
      .join('\n');
    const markdown = renderAgentEvents(
      [
        userText('run'),
        tool({
          title: 'Run tests',
          kind: 'execute',
          content: [{ type: 'content', content: { type: 'text', text: long } }],
        }),
      ],
      { maxCodeBlockLines: 3 },
    );
    expect(markdown).toContain('line 2\n… (+7 more lines)');
    expect(markdown).not.toContain('line 9');
  });
});

describe('renderTurns', () => {
  it('groups one turn per user prompt, splitting user and agent markdown', () => {
    const turns = renderTurns([
      {
        kind: 'message',
        id: 'u1',
        turnId: 'turn-0',
        role: 'user',
        blocks: [{ type: 'text', text: 'first' }],
        isStreaming: false,
      },
      {
        kind: 'message',
        id: 'a1',
        turnId: 'turn-0',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'reply one' }],
        isStreaming: false,
      },
      {
        kind: 'message',
        id: 'u2',
        turnId: 'turn-1',
        role: 'user',
        blocks: [{ type: 'text', text: 'second' }],
        isStreaming: false,
      },
      {
        kind: 'message',
        id: 'a2',
        turnId: 'turn-1',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'reply two' }],
        isStreaming: false,
      },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].userMarkdown).toBe('first');
    expect(turns[0].agentMarkdown).toBe('reply one');
    expect(turns[1].userMarkdown).toBe('second');
    expect(turns[1].agentMarkdown).toBe('reply two');
    expect(turns[1].items).toEqual([{ id: 'a2', kind: 'message', markdown: 'reply two' }]);
  });

  it('re-rendering after more chunks yields a superset markdown for the same turn', () => {
    const events: AgentEvent[] = [userText('go'), chunk('partial', 'a1')];
    const first = renderAgentEvents(events);
    const second = renderAgentEvents([...events, chunk(' and more', 'a1')]);
    expect(second.startsWith(first)).toBe(true);
  });
});

describe('renderItem', () => {
  it('renders reasoning as a blockquote', () => {
    expect(
      renderItem({
        kind: 'reasoning',
        id: 'r1',
        turnId: null,
        blocks: [{ type: 'text', text: 'thinking\n\nhard' }],
        isStreaming: false,
      }),
    ).toBe('> thinking\n>\n> hard');
  });
});
