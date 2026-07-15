import type { AgentEvent, AgentHistoryId } from '@linkcode/schema';
import type { Session } from '@opencode-ai/sdk/v2';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { OpenCodeAdapter } from '../native/opencode';
import type { OpencodeHistoryServerLike } from '../native/opencode/history-server';
import { FakeEventStream } from './fake-event-stream';

const sdkMock = vi.hoisted(() => ({
  createOpencode: null as ((opts: unknown) => unknown) | null,
  createOpencodeClient: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencode(opts: unknown) {
    if (!sdkMock.createOpencode) throw new Error('createOpencode mock not installed');
    return sdkMock.createOpencode(opts);
  },
  createOpencodeClient(opts: unknown) {
    if (!sdkMock.createOpencodeClient) throw new Error('createOpencodeClient mock not installed');
    return sdkMock.createOpencodeClient(opts);
  },
}));

/** History calls run against the shared server; tests stub it to a pass-through. */
const stubServer: OpencodeHistoryServerLike = {
  withServer: (fn) => fn('http://stub'),
};

class HistoryTestAdapter extends OpenCodeAdapter {
  protected override historyServer(): OpencodeHistoryServerLike {
    return stubServer;
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'ses-1',
    slug: 'ses-1',
    projectID: 'proj-1',
    directory: '/tmp/repo',
    title: 'Session',
    version: '1.17.18',
    time: { created: 100, updated: 200 },
    ...overrides,
  };
}

describe('OpenCodeAdapter.listHistory', () => {
  it('filters archived/child/other-cwd sessions, sorts by updatedAt desc, and paginates', async () => {
    const sessions = [
      makeSession({ id: 'ses-old', time: { created: 1, updated: 10 } }),
      makeSession({ id: 'ses-new', time: { created: 2, updated: 30 } }),
      makeSession({ id: 'ses-mid', time: { created: 3, updated: 20 } }),
      makeSession({ id: 'ses-archived', time: { created: 4, updated: 40, archived: 50 } }),
      makeSession({ id: 'ses-child', parentID: 'ses-new', time: { created: 5, updated: 50 } }),
      makeSession({
        id: 'ses-elsewhere',
        directory: '/tmp/other',
        time: { created: 6, updated: 60 },
      }),
    ];
    const list = vi.fn(() => Promise.resolve({ data: sessions }));
    sdkMock.createOpencodeClient = () => ({ session: { list } });

    const adapter = new HistoryTestAdapter();
    const page1 = await adapter.listHistory({ cwd: '/tmp/repo', limit: 2 });
    expect(list).toHaveBeenCalledWith({ roots: true });
    expect(page1.sessions.map((s) => s.historyId)).toEqual(['ses-new', 'ses-mid']);
    expect(page1.cursor).toBe('2');

    const page2 = await adapter.listHistory({ cwd: '/tmp/repo', limit: 2, cursor: page1.cursor });
    expect(page2.sessions.map((s) => s.historyId)).toEqual(['ses-old']);
    expect(page2.cursor).toBeUndefined();
  });
});

describe('OpenCodeAdapter.readHistory', () => {
  it('rejects clearly when the session does not exist', async () => {
    sdkMock.createOpencodeClient = () => ({
      session: {
        get: vi.fn(() => Promise.resolve({ error: { status: 404 } })),
        // Fetched concurrently with `get`; existence is judged off `get`, so this error is unread.
        messages: vi.fn(() => Promise.resolve({ error: { status: 404 } })),
      },
    });
    const adapter = new HistoryTestAdapter();
    await expect(
      adapter.readHistory({ historyId: 'ses-missing' as AgentHistoryId }),
    ).rejects.toThrow("opencode: history 'ses-missing' was not found");
  });

  it('replays messages truncated at the revert marker and paginates events', async () => {
    const user = {
      info: {
        id: 'msg-u1',
        sessionID: 'ses-1',
        role: 'user',
        time: { created: 10 },
        agent: 'build',
        model: { providerID: 'openai', modelID: 'gpt-5.5' },
      },
      parts: [{ id: 'prt-u1', sessionID: 'ses-1', messageID: 'msg-u1', type: 'text', text: 'hi' }],
    };
    const assistant = {
      info: {
        id: 'msg-a1',
        sessionID: 'ses-1',
        role: 'assistant',
        time: { created: 20 },
        parentID: 'msg-u1',
        modelID: 'gpt-5.5',
        providerID: 'openai',
        mode: 'build',
        agent: 'build',
        path: { cwd: '/tmp/repo', root: '/tmp/repo' },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [
        { id: 'prt-a1', sessionID: 'ses-1', messageID: 'msg-a1', type: 'text', text: 'hello' },
      ],
    };
    const reverted = { info: { ...user.info, id: 'msg-u2' }, parts: [] };
    sdkMock.createOpencodeClient = () => ({
      session: {
        get: vi.fn(() =>
          Promise.resolve({ data: makeSession({ revert: { messageID: 'msg-u2' } }) }),
        ),
        messages: vi.fn(() => Promise.resolve({ data: [user, assistant, reverted] })),
      },
    });

    const adapter = new HistoryTestAdapter();
    const page1 = await adapter.readHistory({ historyId: 'ses-1' as AgentHistoryId, limit: 1 });
    expect(page1.session).toMatchObject({ historyId: 'ses-1', kind: 'opencode' });
    expect(page1.events).toHaveLength(1);
    expect(page1.events[0].event).toMatchObject({ type: 'user-message', messageId: 'msg-u1' });
    expect(page1.cursor).toBe('1');

    const page2 = await adapter.readHistory({
      historyId: 'ses-1' as AgentHistoryId,
      limit: 1,
      cursor: page1.cursor,
    });
    // The reverted msg-u2 never replays; the assistant chunk is the final event.
    expect(page2.events[0].event).toMatchObject({
      type: 'agent-message-chunk',
      messageId: 'prt-a1',
    });
    expect(page2.cursor).toBeUndefined();
  });
});

function makeLiveClient(resumedSession: Session | null) {
  const stream = new FakeEventStream();
  return {
    stream,
    session: {
      create: vi.fn(() => Promise.resolve({ data: makeSession({ id: 'ses-created' }) })),
      get: vi.fn(() =>
        Promise.resolve(resumedSession ? { data: resumedSession } : { error: { status: 404 } }),
      ),
      promptAsync: vi.fn(() => Promise.resolve({ data: null })),
    },
    command: { list: vi.fn(() => Promise.resolve({ data: [] })) },
    event: { subscribe: vi.fn(() => Promise.resolve({ stream })) },
  };
}

function sessionRefs(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'session-ref' }>> {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'session-ref' }> => e.type === 'session-ref',
  );
}

describe('OpenCodeAdapter.resumeHistory', () => {
  it('adopts the existing session under its own directory and announces the ref immediately', async () => {
    const client = makeLiveClient(makeSession({ id: 'ses-9', directory: '/tmp/original' }));
    sdkMock.createOpencode = () =>
      Promise.resolve({ client, server: { url: 'http://fake', close: vi.fn() } });

    const adapter = new OpenCodeAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.resumeHistory(
      { historyId: 'ses-9' as AgentHistoryId },
      { kind: 'opencode', cwd: '/tmp/elsewhere' },
    );

    expect(client.session.create).not.toHaveBeenCalled();
    expect(sessionRefs(events).map((e) => e.historyId)).toEqual(['ses-9']);
    // Every session-bound call scopes to the session's real home, not the resume cwd — events
    // ride the per-directory instance bus.
    expect(client.event.subscribe).toHaveBeenCalledWith({ directory: '/tmp/original' });
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'go' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'ses-9', directory: '/tmp/original' }),
    );
  });

  it('rejects when the history id is unknown', async () => {
    const client = makeLiveClient(null);
    sdkMock.createOpencode = () =>
      Promise.resolve({ client, server: { url: 'http://fake', close: vi.fn() } });
    const adapter = new OpenCodeAdapter();
    adapter.onEvent(noop);
    await expect(
      adapter.resumeHistory(
        { historyId: 'ses-gone' as AgentHistoryId },
        { kind: 'opencode', cwd: '/tmp/elsewhere' },
      ),
    ).rejects.toThrow("opencode: history 'ses-gone' was not found");
  });
});

describe('OpenCodeAdapter fresh-session session-ref', () => {
  it('defers the announce until the first on-stream turn acknowledgement', async () => {
    const client = makeLiveClient(null);
    sdkMock.createOpencode = () =>
      Promise.resolve({ client, server: { url: 'http://fake', close: vi.fn() } });

    const adapter = new OpenCodeAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start({ kind: 'opencode', cwd: '/tmp/repo' });
    expect(sessionRefs(events)).toHaveLength(0);

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    expect(sessionRefs(events)).toHaveLength(0);

    client.stream.push({
      id: 'e-busy',
      type: 'session.status',
      properties: { sessionID: 'ses-created', status: { type: 'busy' } },
    });
    await vi.waitFor(() => expect(sessionRefs(events)).toHaveLength(1));
    expect(sessionRefs(events)[0].historyId).toBe('ses-created');
  });
});
