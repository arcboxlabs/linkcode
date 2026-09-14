import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as sdk from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import { ClaudeCodeAdapter } from '../native/claude-code';
import { claudeHistorySdk } from '../native/claude-history-sdk';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function transcript(sessionId: string, answer: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'linkcode-claude-root-'));
  roots.push(root);
  const project = path.join(root, 'projects', 'fixture');
  await mkdir(project, { recursive: true });
  const userId = randomUUID();
  const assistantId = randomUUID();
  const rows = [
    {
      type: 'user',
      uuid: userId,
      parentUuid: null,
      sessionId,
      timestamp: '2026-09-01T00:00:00Z',
      message: { role: 'user', content: 'hello' },
    },
    {
      type: 'assistant',
      uuid: assistantId,
      parentUuid: userId,
      sessionId,
      timestamp: '2026-09-01T00:00:01Z',
      message: {
        id: assistantId,
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: answer }],
      },
    },
  ];
  await writeFile(
    path.join(project, `${sessionId}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  );
  return { root, assistantId };
}

describe('Claude native history config roots', () => {
  it('reads concurrent account roots without changing the daemon environment', async () => {
    const historyId = asHistoryId(randomUUID());
    const before = process.env.CLAUDE_CONFIG_DIR;
    const [a, b] = await Promise.all([
      transcript(historyId, 'account A'),
      transcript(historyId, 'account B'),
    ]);
    const results = await Promise.all(
      [a, b].map(({ root }) =>
        new ClaudeCodeAdapter().readHistory({
          historyId,
          config: { extraEnv: { CLAUDE_CONFIG_DIR: root } },
        }),
      ),
    );
    expect(
      results.map((result) =>
        result.events.flatMap(({ event }) => (event.type === 'agent-message' ? event.content : [])),
      ),
    ).toEqual([[{ type: 'text', text: 'account A' }], [{ type: 'text', text: 'account B' }]]);
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(before);
  });

  it('forks in the source config root and reports a missing history explicitly', async () => {
    const historyId = asHistoryId(randomUUID());
    const { root, assistantId } = await transcript(historyId, 'retained answer');
    const scoped = claudeHistorySdk(sdk, root);
    const child = await scoped.forkSession(historyId, { upToMessageId: assistantId });
    expect(await scoped.getSessionMessages(child.sessionId)).toHaveLength(2);
    await expect(
      new ClaudeCodeAdapter().readHistory({
        historyId: asHistoryId(randomUUID()),
        config: { extraEnv: { CLAUDE_CONFIG_DIR: root } },
      }),
    ).rejects.toThrow('native history');
  });
});
