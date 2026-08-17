import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import {
  findCodexTranscript,
  readCodexIndex,
  readCodexTranscriptSummaries,
  readJsonlFile,
} from '../native/codex/history';

const THREAD_ID = '019f1111-2222-7333-8444-555566667777';

function rolloutLines(id: string): string[] {
  return [
    JSON.stringify({
      timestamp: '2026-08-01T10:00:00.000Z',
      type: 'session_meta',
      payload: { id, cwd: '/repo', model: 'sol-1', cli_version: '0.144.1' },
    }),
    JSON.stringify({
      timestamp: '2026-08-01T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'real prompt' },
    }),
    // Machine-injected row: marker-bearing, never echoed — must not count or title.
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>...</environment_context>' }],
      },
    }),
    JSON.stringify({
      timestamp: '2026-08-01T10:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'real prompt' }],
      },
    }),
    JSON.stringify({
      timestamp: '2026-08-01T10:00:05.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'an answer' }],
      },
    }),
  ];
}

/** Exercises the streaming rollout reads against a throwaway `CODEX_HOME` — the summary pass and
 * the filename fast path both changed for the 2026-08 daemon OOM fix and must keep the whole-file
 * pass's semantics. */
describe('codex rollout file reads', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'codex-history-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function writeRollout(relative: string, lines: string[]): Promise<string> {
    const path = join(home, relative);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `${lines.join('\n')}\n`);
    return path;
  }

  it('summarizes a rollout in one streaming pass with the whole-file semantics', async () => {
    await writeRollout(
      `sessions/2026/08/01/rollout-2026-08-01T10-00-00-${THREAD_ID}.jsonl`,
      rolloutLines(THREAD_ID),
    );
    const summaries = await readCodexTranscriptSummaries(await readCodexIndex(home), home);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: THREAD_ID,
      cwd: '/repo',
      model: 'sol-1',
      title: 'real prompt',
      messageCount: 2,
      createdAt: Date.parse('2026-08-01T10:00:00.000Z'),
      updatedAt: Date.parse('2026-08-01T10:00:05.000Z'),
    });
  });

  it('skips corrupt lines and ignores empty files', async () => {
    const path = await writeRollout(
      `sessions/2026/08/01/rollout-2026-08-01T10-00-00-${THREAD_ID}.jsonl`,
      [...rolloutLines(THREAD_ID), '{"truncated": '],
    );
    await writeRollout('sessions/2026/08/01/rollout-empty.jsonl', ['']);

    expect(await readJsonlFile(path)).toHaveLength(5);
    const summaries = await readCodexTranscriptSummaries(await readCodexIndex(home), home);
    expect(summaries.map((summary) => summary.id)).toEqual([THREAD_ID]);
  });

  it('finds a transcript through the filename fast path', async () => {
    // A decoy whose name carries a different id must not satisfy the lookup.
    await writeRollout(
      'sessions/2026/08/01/rollout-2026-08-01T09-00-00-019f0000-aaaa-7bbb-8ccc-dddd00000000.jsonl',
      rolloutLines('019f0000-aaaa-7bbb-8ccc-dddd00000000'),
    );
    await writeRollout(
      `archived_sessions/rollout-2026-08-01T10-00-00-${THREAD_ID}.jsonl`,
      rolloutLines(THREAD_ID),
    );

    const found = await findCodexTranscript(asHistoryId(THREAD_ID), home);
    expect(found).toMatchObject({ id: THREAD_ID, title: 'real prompt' });
  });

  it('falls back to the full scan when the filename does not carry the id', async () => {
    await writeRollout('sessions/renamed-rollout.jsonl', rolloutLines(THREAD_ID));

    const found = await findCodexTranscript(asHistoryId(THREAD_ID), home);
    expect(found).toMatchObject({ id: THREAD_ID, cwd: '/repo' });
  });

  it('returns undefined for an unknown id', async () => {
    await writeRollout(
      `sessions/rollout-2026-08-01T10-00-00-${THREAD_ID}.jsonl`,
      rolloutLines(THREAD_ID),
    );
    expect(
      await findCodexTranscript(asHistoryId('019f9999-0000-7000-8000-000000000000'), home),
    ).toBeUndefined();
  });
});
