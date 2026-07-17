/* eslint-disable sukka/type/no-force-cast-via-top-type --
 * Fixtures model raw session-file rows: the SDK's typed AgentMessage union requires
 * provider-populated fields (usage/api/timestamp) irrelevant here, and omits augmented roles
 * (bashExecution) entirely — the mapper under test reads all of them structurally. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionEntry, SessionInfo } from '@earendil-works/pi-coding-agent';
import type { AgentEvent, ToolCall } from '@linkcode/schema';
import { createFixedArray } from 'foxts/create-fixed-array';
import { noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asHistoryId } from '../history-util';
import type { PiSdk } from '../native/pi/history';
import {
  findPiSessionFile,
  listPiHistory,
  mapPiHistoryEvents,
  readPiHistory,
} from '../native/pi/history';

const HISTORY_ID = asHistoryId('019f-test');

function messageEntry(id: string, message: unknown, timestamp = '2026-07-17T02:35:31.950Z') {
  return { type: 'message', id, parentId: null, timestamp, message } as unknown as SessionEntry;
}

function eventsOf(entries: SessionEntry[]): AgentEvent[] {
  return mapPiHistoryEvents(HISTORY_ID, entries).map((e) => e.event);
}

function toolCalls(events: AgentEvent[]): ToolCall[] {
  return events.flatMap((e) => (e.type === 'tool-call' ? [e.toolCall] : []));
}

describe('mapPiHistoryEvents', () => {
  it('maps user and assistant text with entry-derived stable ids', () => {
    const events = mapPiHistoryEvents(HISTORY_ID, [
      messageEntry('u1', { role: 'user', content: [{ type: 'text', text: 'hello' }] }),
      messageEntry('a1', {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'pondering' },
          { type: 'text', text: 'hi there' },
        ],
      }),
    ]);

    expect(events.map((e) => e.event.type)).toEqual([
      'user-message',
      'agent-thought-chunk',
      'agent-message-chunk',
    ]);
    expect(events[0]).toMatchObject({ historyId: HISTORY_ID, itemId: 'u1' });
    const thought = events[1].event;
    if (thought.type !== 'agent-thought-chunk') throw new Error('expected thought');
    expect(thought.messageId).toBe('a1-thought');
    const text = events[2].event;
    if (text.type !== 'agent-message-chunk') throw new Error('expected message chunk');
    expect(text.messageId).toBe('a1');
  });

  it('correlates tool announce and settle by the provider tool-call id', () => {
    const events = eventsOf([
      messageEntry('a1', {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'edit',
            arguments: { path: 'src/x.ts', old: 'a', new: 'b' },
          },
        ],
      }),
      messageEntry('t1', {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'edit',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      }),
    ]);

    const calls = toolCalls(events);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      toolCallId: 'call-1',
      title: 'edit',
      kind: 'edit',
      status: 'in_progress',
      locations: [{ path: 'src/x.ts' }],
    });
    expect(calls[1]).toMatchObject({
      toolCallId: 'call-1',
      title: 'edit',
      status: 'completed',
      locations: [{ path: 'src/x.ts' }],
    });
  });

  it('settles an error result as failed and tolerates an orphan settle', () => {
    const events = eventsOf([
      messageEntry('t1', {
        role: 'toolResult',
        toolCallId: 'call-x',
        toolName: 'bash',
        content: 'boom',
        isError: true,
      }),
    ]);
    expect(toolCalls(events)[0]).toMatchObject({
      toolCallId: 'call-x',
      title: 'bash',
      kind: 'execute',
      status: 'failed',
    });
  });

  it('replays a bashExecution as a settled execute card', () => {
    const events = eventsOf([
      messageEntry('b1', {
        role: 'bashExecution',
        command: 'ls -la',
        output: 'total 0',
        exitCode: 0,
        timestamp: 123,
      }),
    ]);
    expect(toolCalls(events)[0]).toMatchObject({
      toolCallId: 'pi-bash-b1',
      title: 'ls -la',
      kind: 'execute',
      status: 'completed',
      rawOutput: { output: 'total 0', exitCode: 0 },
    });
  });

  it('skips non-message entries and empty text', () => {
    const events = eventsOf([
      {
        type: 'model_change',
        id: 'm1',
        parentId: null,
        timestamp: 't',
        provider: 'openai',
        modelId: 'gpt-test',
      } as unknown as SessionEntry,
      messageEntry('u1', { role: 'user', content: '   ' }),
      messageEntry('a1', { role: 'assistant', content: [] }),
    ]);
    expect(events).toHaveLength(0);
  });
});

describe('findPiSessionFile', () => {
  it('locates a session file by id suffix without parsing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-sessions-'));
    mkdirSync(join(root, '--slug--'), { recursive: true });
    const file = join(root, '--slug--', '2026-07-17T02-35-31-897Z_abc123.jsonl');
    writeFileSync(file, '');

    await expect(findPiSessionFile('abc123', root)).resolves.toBe(file);
    await expect(findPiSessionFile('missing', root)).resolves.toBeNull();
    await expect(findPiSessionFile('abc123', join(root, 'nope'))).resolves.toBeNull();
  });
});

function fakeSdk(overrides: Partial<Record<keyof PiSdk['SessionManager'], unknown>>): PiSdk {
  return {
    SessionManager: overrides,
    buildContextEntries: (entries: SessionEntry[]) => entries,
  } as unknown as PiSdk;
}

const INFO: SessionInfo = {
  path: '/sessions/--x--/2026_id-1.jsonl',
  id: 'id-1',
  cwd: '/work/x',
  name: 'My session',
  created: new Date('2026-07-17T02:00:00Z'),
  modified: new Date('2026-07-17T03:00:00Z'),
  messageCount: 4,
  firstMessage: 'hello world',
  allMessagesText: 'hello world',
};

describe('listPiHistory', () => {
  it('lists all sessions and scopes by cwd when given', async () => {
    const list = vi.fn(() => Promise.resolve([INFO]));
    const listAll = vi.fn(() => Promise.resolve([INFO, { ...INFO, id: 'id-2', name: undefined }]));
    const sdk = fakeSdk({ list, listAll });

    const all = await listPiHistory(sdk);
    expect(listAll).toHaveBeenCalled();
    expect(all.sessions).toHaveLength(2);
    expect(all.sessions[0]).toMatchObject({
      historyId: 'id-1',
      kind: 'pi',
      title: 'My session',
      cwd: '/work/x',
      messageCount: 4,
      metadata: { path: INFO.path },
    });
    expect(all.sessions[1].title).toBe('hello world');

    const scoped = await listPiHistory(sdk, { cwd: '/work/x' });
    expect(list).toHaveBeenCalledWith('/work/x');
    expect(scoped.sessions).toHaveLength(1);
  });

  it('paginates with offset cursors', async () => {
    const infos = createFixedArray(3).map((i) => ({ ...INFO, id: `id-${i}` }));
    const sdk = fakeSdk({ listAll: () => Promise.resolve(infos) });

    const first = await listPiHistory(sdk, { limit: 2 });
    expect(first.sessions.map((s) => s.historyId)).toEqual(['id-0', 'id-1']);
    expect(first.cursor).toBe('2');

    const rest = await listPiHistory(sdk, { limit: 2, cursor: first.cursor });
    expect(rest.sessions.map((s) => s.historyId)).toEqual(['id-2']);
    expect(rest.cursor).toBeUndefined();
  });
});

describe('readPiHistory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens the resolved file and replays the context path', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-agent-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    mkdirSync(join(agentDir, 'sessions', '--x--'), { recursive: true });
    writeFileSync(join(agentDir, 'sessions', '--x--', '2026_id-1.jsonl'), '');

    const entries = [
      messageEntry('u1', { role: 'user', content: 'hello world' }),
      messageEntry('a1', { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }),
    ];
    const open = vi.fn(() => ({
      getEntries: () => entries,
      getLeafId: () => 'a1',
      getHeader: () => ({
        type: 'session',
        id: 'id-1',
        timestamp: '2026-07-17T02:00:00Z',
        cwd: '/work/x',
      }),
      getSessionName: noop as () => string | undefined,
    }));
    const sdk = fakeSdk({ open });

    const result = await readPiHistory(sdk, { historyId: asHistoryId('id-1') });
    expect(open).toHaveBeenCalledWith(join(agentDir, 'sessions', '--x--', '2026_id-1.jsonl'));
    expect(result.session).toMatchObject({
      historyId: 'id-1',
      kind: 'pi',
      title: 'hello world',
      cwd: '/work/x',
      messageCount: 2,
    });
    expect(result.events.map((e) => e.event.type)).toEqual(['user-message', 'agent-message-chunk']);
    expect(result.cursor).toBeUndefined();
  });

  it('rejects clearly when the session id resolves to no file', async () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'pi-agent-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
    await expect(readPiHistory(fakeSdk({}), { historyId: asHistoryId('ghost') })).rejects.toThrow(
      "pi: history 'ghost' was not found",
    );
  });
});
