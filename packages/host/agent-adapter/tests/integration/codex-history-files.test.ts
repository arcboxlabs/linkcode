import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { describe, expect, it } from 'vitest';
import { asHistoryId } from '../../src/history-util';
import { CodexAdapter } from '../../src/native/codex';

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
            // Machine-injected context codex persists as a user-role message; must not replay
            // as a user bubble or count as a conversation message.
            timestamp: '2026-06-17T01:00:30.000Z',
            type: 'response_item',
            payload: {
              id: 'synthetic-1',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>',
                },
              ],
            },
          },
          {
            // The codex 0.144 injection shape: AGENTS.md prose part + env part in one row.
            timestamp: '2026-06-17T01:00:31.000Z',
            type: 'response_item',
            payload: {
              id: 'synthetic-2',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>',
                },
                {
                  type: 'input_text',
                  text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>',
                },
              ],
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

  it('pages an image-heavy transcript by aggregate attachment payload across cursor reads', async () => {
    const previousCodexHome = env.CODEX_HOME;
    const codexHome = await mkdtemp(join(tmpdir(), 'linkcode-codex-history-'));
    try {
      env.CODEX_HOME = codexHome;
      const sessionDir = join(codexHome, 'sessions', '2026', '07', '20');
      await mkdir(sessionDir, { recursive: true });
      // Two prompts whose images together exceed one page's attachment budget
      // (MAX_ATTACHMENT_TOTAL_BASE64_LENGTH) while each stays under the per-image cap.
      const imageData = 'A'.repeat(9 * 1024 * 1024);
      const userRow = (id: string, text: string) => ({
        type: 'response_item',
        payload: {
          id,
          role: 'user',
          content: [
            { type: 'input_text', text },
            { type: 'input_image', image_url: `data:image/png;base64,${imageData}` },
          ],
        },
      });
      const assistantRow = (id: string, text: string) => ({
        type: 'response_item',
        payload: { id, role: 'assistant', content: [{ type: 'output_text', text }] },
      });
      await writeFile(
        join(sessionDir, 'rollout-thread-img.jsonl'),
        [
          { type: 'session_meta', payload: { id: 'thread-img', cwd: '/repo' } },
          userRow('user-1', 'first shot'),
          assistantRow('assistant-1', 'looks good'),
          userRow('user-2', 'second shot'),
          assistantRow('assistant-2', 'done'),
        ]
          .map((row) => JSON.stringify(row))
          .join('\n'),
      );

      const adapter = new CodexAdapter();
      const historyId = asHistoryId('thread-img');
      const first = await adapter.readHistory({ historyId, limit: 10 });
      expect(first.events.map((event) => event.itemId)).toEqual(['user-1', 'assistant-1']);
      expect(first.cursor).toBe('2');
      expect(first.events[0]?.event).toMatchObject({
        type: 'user-message',
        content: [
          { type: 'text', text: 'first shot' },
          { type: 'image', data: imageData, mimeType: 'image/png' },
        ],
      });

      const rest = await adapter.readHistory({ historyId, cursor: first.cursor, limit: 10 });
      expect(rest.events.map((event) => event.itemId)).toEqual(['user-2', 'assistant-2']);
      expect(rest.cursor).toBeUndefined();
    } finally {
      if (previousCodexHome === undefined) env.CODEX_HOME = undefined;
      else env.CODEX_HOME = previousCodexHome;
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});
