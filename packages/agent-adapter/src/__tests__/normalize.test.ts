import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { acpUpdateToEvent, mapAcpStop } from '../acp/acp-adapter';
import { claudeToolResultEvents, editToolDiffs, mapClaudeStop } from '../native/claude-code';
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
        'user-message-chunk',
        'agent-message-chunk',
      ]);
      expect(read.events[0]?.event).toMatchObject({
        type: 'user-message-chunk',
        messageId: 'user-1',
        content: { type: 'text', text: 'hello' },
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
  it('acp (identity-ish)', () => {
    expect(mapAcpStop('refusal')).toBe('refusal');
    expect(mapAcpStop('something_else')).toBe('end_turn');
  });
});

describe('acpUpdateToEvent', () => {
  it('maps an agent message chunk', () => {
    expect(
      acpUpdateToEvent(
        sessionUpdateFixture({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hi' },
        }),
      ),
    ).toEqual({ type: 'agent-message-chunk', content: { type: 'text', text: 'hi' } });
  });
  it('maps a tool call with fallbacks', () => {
    const event = acpUpdateToEvent(
      sessionUpdateFixture({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
      }),
    );
    expect(event).toEqual({
      type: 'tool-call',
      toolCall: { toolCallId: 't1', title: 't1', kind: 'other', status: 'pending', content: [] },
    });
  });
  it('returns null for unknown updates', () => {
    expect(acpUpdateToEvent(sessionUpdateFixture({ sessionUpdate: 'something_new' }))).toBeNull();
  });
});

function sessionUpdateFixture(value: object): SessionUpdate {
  return value as SessionUpdate;
}

type ClaudeUserMessage = Parameters<typeof claudeToolResultEvents>[0];
function claudeUserFixture(content: unknown, toolUseResult?: unknown): ClaudeUserMessage {
  return { type: 'user', message: { role: 'user', content }, tool_use_result: toolUseResult } as ClaudeUserMessage;
}

describe('claudeToolResultEvents', () => {
  it('maps a successful tool_result to a completed tool-call-update', () => {
    expect(
      claudeToolResultEvents(
        claudeUserFixture([{ type: 'tool_result', tool_use_id: 't1', content: 'done' }]),
      ),
    ).toEqual([
      {
        type: 'tool-call-update',
        update: {
          toolCallId: 't1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
          rawOutput: 'done',
        },
      },
    ]);
  });

  it('marks is_error results as failed and flattens block-array content', () => {
    const [event] = claudeToolResultEvents(
      claudeUserFixture([
        {
          type: 'tool_result',
          tool_use_id: 't2',
          is_error: true,
          content: [
            { type: 'text', text: 'boom' },
            { type: 'image', source: { type: 'base64', data: 'x', media_type: 'image/png' } },
          ],
        },
      ]),
    );
    expect(event).toMatchObject({
      type: 'tool-call-update',
      update: {
        toolCallId: 't2',
        status: 'failed',
        content: [{ type: 'content', content: { type: 'text', text: 'boom' } }],
      },
    });
  });

  it('ignores non-tool_result blocks and string content', () => {
    expect(claudeToolResultEvents(claudeUserFixture('just text'))).toEqual([]);
    expect(claudeToolResultEvents(claudeUserFixture([{ type: 'text', text: 'hi' }]))).toEqual([]);
  });
});

describe('editToolDiffs', () => {
  it('builds an old→new diff for an Edit input', () => {
    expect(editToolDiffs({ file_path: '/a.ts', old_string: 'foo', new_string: 'bar' })).toEqual([
      { type: 'diff', path: '/a.ts', oldText: 'foo', newText: 'bar' },
    ]);
  });
  it('builds a new-only diff for a Write input', () => {
    expect(editToolDiffs({ file_path: '/a.ts', content: 'hello' })).toEqual([
      { type: 'diff', path: '/a.ts', newText: 'hello' },
    ]);
  });
  it('expands MultiEdit edits into one diff each', () => {
    expect(
      editToolDiffs({
        file_path: '/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    ).toEqual([
      { type: 'diff', path: '/a.ts', oldText: 'a', newText: 'b' },
      { type: 'diff', path: '/a.ts', oldText: 'c', newText: 'd' },
    ]);
  });
  it('returns nothing for non-edit tool inputs', () => {
    expect(editToolDiffs({ command: 'ls' })).toEqual([]);
    expect(editToolDiffs('nope')).toEqual([]);
  });
});
