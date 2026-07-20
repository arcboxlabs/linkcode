/* eslint-disable sukka/type/no-force-cast-via-top-type -- raw SDK persistence fixtures */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEntry, SessionInfo } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asHistoryId } from '../history-util';
import type { PiSdk } from '../native/pi/history';
import {
  findPiSessionFile,
  listPiHistory,
  mapPiHistoryEvents,
  readPiHistory,
} from '../native/pi/history';

function entry(id: string, message: unknown) {
  return {
    type: 'message',
    id,
    parentId: null,
    timestamp: '2026-07-17T02:00:00Z',
    message,
  } as unknown as SessionEntry;
}
function manager(entries: SessionEntry[]) {
  return {
    getBranch: () => entries,
    getHeader: () => ({ timestamp: '2026-07-17T02:00:00Z', cwd: '/work' }),
    getSessionName() {
      return null;
    },
  };
}
function pi(SessionManager: Record<string, unknown>) {
  return { SessionManager } as unknown as PiSdk;
}

afterEach(() => vi.unstubAllEnvs());

describe('Pi history', () => {
  it('maps user, thought, text, and correlated tool history', () => {
    const events = mapPiHistoryEvents(asHistoryId('id'), [
      entry('u', { role: 'user', content: 'hello' }),
      entry('a', {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'answer' },
          { type: 'toolCall', id: 'tool', name: 'read', arguments: { path: 'a.ts' } },
        ],
      }),
      entry('r', {
        role: 'toolResult',
        toolCallId: 'tool',
        toolName: 'read',
        content: 'ok',
        isError: false,
      }),
    ]);
    expect(events.map(({ event }) => event.type)).toEqual([
      'user-message',
      'agent-thought-chunk',
      'agent-message-chunk',
      'tool-call',
      'tool-call',
    ]);
    expect(events.at(-1)?.event).toMatchObject({
      toolCall: { toolCallId: 'tool', status: 'completed', locations: [{ path: 'a.ts' }] },
    });
  });

  it('lists and reads through SessionManager', async () => {
    const info = {
      id: 'id',
      path: '/p',
      cwd: '/work',
      name: 'Title',
      created: new Date(1),
      modified: new Date(2),
      messageCount: 2,
      firstMessage: 'hello',
      allMessagesText: 'hello',
    } as SessionInfo;
    const listAll = vi.fn(() => Promise.resolve([info]));
    const listed = await listPiHistory(pi({ listAll }));
    expect(listed.sessions[0]).toMatchObject({ historyId: 'id', title: 'Title', cwd: '/work' });

    const root = mkdtempSync(join(tmpdir(), 'pi-history-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', root);
    mkdirSync(join(root, 'sessions', 'slug'), { recursive: true });
    const file = join(root, 'sessions', 'slug', '2026_id.jsonl');
    writeFileSync(file, '');
    const open = vi.fn(() => manager([entry('u', { role: 'user', content: 'hello' })]));
    const read = await readPiHistory(pi({ open }), { historyId: asHistoryId('id') });
    expect(open).toHaveBeenCalledWith(file);
    expect(read.session).toMatchObject({ historyId: 'id', cwd: '/work', messageCount: 1 });
    expect(read.events).toHaveLength(1);
  });

  it('matches the exact file id rather than a colliding suffix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-collision-'));
    mkdirSync(join(root, 'slug'));
    const long = join(root, 'slug', '2026_abc_123.jsonl');
    writeFileSync(long, '');
    await expect(findPiSessionFile('123', root)).resolves.toBeNull();
    await expect(findPiSessionFile('abc_123', root)).resolves.toBe(long);
  });
});
