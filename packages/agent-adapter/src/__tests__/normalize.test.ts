import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import {
  ClaudeCodeAdapter,
  createClaudeHistoryEventMapper,
  mapClaudeStop,
} from '../native/claude-code';
import { CodexAdapter, mapCodexStatus, mapCodexUsage } from '../native/codex';
import { contentToText, toolKindFromName } from '../util';

describe('contentToText', () => {
  it('flattens text blocks and drops non-text', () => {
    expect(
      contentToText([
        { type: 'text', text: 'a' },
        { type: 'image', data: 'x', mimeType: 'image/png' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });
});

describe('toolKindFromName', () => {
  it('maps common tool names to ACP tool kinds', () => {
    expect(toolKindFromName('Read')).toBe('read');
    expect(toolKindFromName('Edit')).toBe('edit');
    expect(toolKindFromName('Bash')).toBe('execute');
    expect(toolKindFromName('Grep')).toBe('search');
    expect(toolKindFromName('WebFetch')).toBe('fetch');
    expect(toolKindFromName('Mystery')).toBe('other');
  });
});

function row(
  type: 'user' | 'assistant',
  uuid: string,
  content: string | unknown[],
  parentToolUseId: string | null = null,
): SessionMessage {
  return {
    type,
    uuid,
    session_id: 'h1',
    parent_tool_use_id: parentToolUseId,
    message: { content },
  };
}

describe('createClaudeHistoryEventMapper', () => {
  const historyId = asHistoryId('h1');

  it('replays a tool call as announce and settle snapshots under the provider tool_use id', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const announce = map(
      row('assistant', 'u1', [
        { type: 'text', text: 'let me read that' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file: 'a.ts' } },
      ]),
    );
    expect(announce.map((e) => e.event.type)).toEqual(['agent-message-chunk', 'tool-call']);
    expect(announce[1].itemId).toBe('toolu_1');
    if (announce[1].event.type === 'tool-call') {
      expect(announce[1].event.toolCall).toMatchObject({
        toolCallId: 'toolu_1',
        title: 'Read',
        kind: 'read',
        status: 'in_progress',
        rawInput: { file: 'a.ts' },
      });
    }

    const settle = map(
      row('user', 'u2', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body' }]),
    );
    // The synthetic tool-result row settles the call; it must not render as a user message.
    expect(settle.map((e) => e.event.type)).toEqual(['tool-call']);
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall).toMatchObject({
        toolCallId: 'toolu_1',
        title: 'Read',
        kind: 'read',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
        rawInput: { file: 'a.ts' },
      });
    }
  });

  it('marks is_error results failed and tolerates a settle whose announce is outside the page', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const settle = map(
      row('user', 'u1', [
        { type: 'tool_result', tool_use_id: 'toolu_9', is_error: true, content: 'denied' },
      ]),
    );
    expect(settle).toHaveLength(1);
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall).toMatchObject({
        toolCallId: 'toolu_9',
        title: 'toolu_9',
        kind: 'other',
        status: 'failed',
      });
    }
  });

  it('parses an Edit announce into diff content and keeps it ahead of the settle text', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const input = { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' };
    const announce = map(
      row('assistant', 'u1', [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input }]),
    );
    if (announce[0].event.type === 'tool-call') {
      expect(announce[0].event.toolCall.content).toEqual([
        { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' },
      ]);
    }

    const settle = map(
      row('user', 'u2', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'updated' }]),
    );
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall.content).toEqual([
        { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' },
        { type: 'content', content: { type: 'text', text: 'updated' } },
      ]);
    }
  });

  it('keeps plain user prompts and assistant text as message events', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const prompt = map(row('user', 'u1', 'fix the bug'));
    expect(prompt.map((e) => e.event.type)).toEqual(['user-message']);
    expect(prompt[0].event).toMatchObject({ messageId: 'u1' });

    const reply = map(row('assistant', 'u2', [{ type: 'text', text: 'done' }]));
    expect(reply.map((e) => e.event.type)).toEqual(['agent-message-chunk']);
  });

  it('stamps parentToolCallId on subagent rows and classifies Task as task-kind', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const announce = map(
      row('assistant', 'u1', [
        { type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'explore' } },
      ]),
    );
    if (announce[0].event.type === 'tool-call') {
      expect(announce[0].event.toolCall).toMatchObject({ kind: 'task', toolCallId: 'toolu_task' });
    }

    const subText = map(
      row('assistant', 'u2', [{ type: 'text', text: 'looking around' }], 'toolu_task'),
    );
    expect(subText[0].event).toMatchObject({
      type: 'agent-message-chunk',
      parentToolCallId: 'toolu_task',
    });

    const subTool = map(
      row(
        'assistant',
        'u3',
        [{ type: 'tool_use', id: 'toolu_sub', name: 'Read', input: {} }],
        'toolu_task',
      ),
    );
    if (subTool[0].event.type === 'tool-call') {
      expect(subTool[0].event.toolCall.parentToolCallId).toBe('toolu_task');
    }

    const subSettle = map(
      row(
        'user',
        'u4',
        [{ type: 'tool_result', tool_use_id: 'toolu_sub', content: 'ok' }],
        'toolu_task',
      ),
    );
    if (subSettle[0].event.type === 'tool-call') {
      expect(subSettle[0].event.toolCall).toMatchObject({
        status: 'completed',
        parentToolCallId: 'toolu_task',
      });
    }
  });

  it('skips the injected subagent prompt on subagent user rows', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const events = map(row('user', 'u1', 'map the repo structure', 'toolu_task'));
    expect(events).toEqual([]);
  });
});

class TestClaude extends ClaudeCodeAdapter {
  feed(value: object): void {
    this.handleMessage(value as SDKMessage);
  }
}

function toolSnapshots(events: AgentEvent[]) {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'tool-call' }> => e.type === 'tool-call',
  );
}

describe('ClaudeCodeAdapter Edit diff normalization', () => {
  it('announces the Edit diff and keeps it through the settle', () => {
    const adapter = new TestClaude();
    const seen: AgentEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    adapter.feed({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Edit',
            input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' },
          },
        ],
      },
    });
    adapter.feed({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'updated' }] },
    });

    const diff = { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' };
    const tools = toolSnapshots(seen);
    expect(tools).toHaveLength(2);
    expect(tools[0].toolCall.content).toEqual([diff]);
    expect(tools[1].toolCall.status).toBe('completed');
    expect(tools[1].toolCall.content).toEqual([
      diff,
      { type: 'content', content: { type: 'text', text: 'updated' } },
    ]);
  });

  it('parses a Write announce into a whole-file diff without oldText', () => {
    const adapter = new TestClaude();
    const seen: AgentEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    adapter.feed({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Write',
            input: { file_path: 'src/new.ts', content: 'export const a = 1;\n' },
          },
        ],
      },
    });

    const tools = toolSnapshots(seen);
    expect(tools).toHaveLength(1);
    expect(tools[0].toolCall.content).toEqual([
      { type: 'diff', path: 'src/new.ts', newText: 'export const a = 1;\n' },
    ]);
  });

  it('leaves non-Edit tools and malformed Edit inputs as raw passthrough', () => {
    const adapter = new TestClaude();
    const seen: AgentEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    adapter.feed({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/a.ts' } },
          { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'src/a.ts' } },
        ],
      },
    });

    const tools = toolSnapshots(seen);
    expect(tools).toHaveLength(2);
    expect(tools[0].toolCall.content).toEqual([]);
    expect(tools[1].toolCall.content).toEqual([]);
  });
});

describe('codex mappers', () => {
  it('passes status through', () => {
    expect(mapCodexStatus('in_progress')).toBe('in_progress');
    expect(mapCodexStatus('failed')).toBe('failed');
  });
  it('maps usage fields', () => {
    expect(
      mapCodexUsage({
        input_tokens: 10,
        output_tokens: 20,
        cached_input_tokens: 3,
        reasoning_output_tokens: 5,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 });
  });
});

describe('CodexAdapter history', () => {
  it('lists and reads local Codex JSONL transcripts', async () => {
    const previousCodexHome = env.CODEX_HOME;
    const codexHome = await mkdtemp(join(tmpdir(), 'linkcode-codex-history-'));
    try {
      env.CODEX_HOME = codexHome;
      const sessionDir = join(codexHome, 'sessions', '2026', '06', '17');
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(codexHome, 'session_index.jsonl'),
        `${JSON.stringify({
          id: 'thread-1',
          thread_name: 'Fixture thread',
          updated_at: '2026-06-17T01:03:00.000Z',
        })}\n`,
      );
      await writeFile(
        join(sessionDir, 'rollout-thread-1.jsonl'),
        [
          {
            timestamp: '2026-06-17T01:00:00.000Z',
            type: 'session_meta',
            payload: {
              id: 'thread-1',
              cwd: '/repo',
              model: 'gpt-test',
              cli_version: '1.2.3',
              git: { branch: 'main' },
            },
          },
          {
            timestamp: '2026-06-17T01:01:00.000Z',
            type: 'response_item',
            payload: {
              id: 'user-1',
              role: 'user',
              content: [{ type: 'input_text', text: 'hello' }],
            },
          },
          {
            timestamp: '2026-06-17T01:02:00.000Z',
            type: 'response_item',
            payload: {
              id: 'assistant-1',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'world' }],
            },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n'),
      );

      const adapter = new CodexAdapter();
      const listed = await adapter.listHistory({ cwd: '/repo', limit: 1 });
      const session = listed.sessions[0];
      expect(session).toMatchObject({
        historyId: 'thread-1',
        kind: 'codex',
        title: 'Fixture thread',
        cwd: '/repo',
        model: 'gpt-test',
        messageCount: 2,
      });

      const read = await adapter.readHistory({ historyId: session.historyId, limit: 10 });
      expect(read.events.map((event) => event.event.type)).toEqual([
        'user-message',
        'agent-message-chunk',
      ]);
      expect(read.events[0]?.event).toMatchObject({
        type: 'user-message',
        messageId: 'user-1',
        content: [{ type: 'text', text: 'hello' }],
      });
      expect(read.events[1]?.event).toMatchObject({
        type: 'agent-message-chunk',
        messageId: 'assistant-1',
        content: { type: 'text', text: 'world' },
      });
    } finally {
      if (previousCodexHome === undefined) env.CODEX_HOME = undefined;
      else env.CODEX_HOME = previousCodexHome;
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});

describe('stop reason mappers', () => {
  it('claude', () => {
    expect(mapClaudeStop('max_tokens')).toBe('max_tokens');
    expect(mapClaudeStop('tool_use')).toBe('end_turn');
    expect(mapClaudeStop(null)).toBe('end_turn');
  });
});
