import type { AgentEvent, AgentHistoryId } from '@linkcode/schema';
import type { Session } from '@opencode-ai/sdk/v2';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { OpenCodeAdapter } from '../native/opencode';
import type { OpencodeHistoryServerLike } from '../native/opencode/history-server';
import { FakeEventStream } from './fake-event-stream';

const sdkMock = vi.hoisted(
  (): {
    createOpencode: ((opts: unknown) => unknown) | null;
    createOpencodeClient: ((opts: unknown) => unknown) | null;
    liveClient: unknown;
  } => ({ createOpencode: null, createOpencodeClient: null, liveClient: null }),
);

vi.mock('@opencode-ai/sdk/v2', () => ({
  // History reads pass the stub server's url; the live session client is whatever the last
  // bridged serve spawn produced (see the serve mock below).
  createOpencodeClient(opts: { baseUrl?: string }) {
    if (opts.baseUrl === 'http://stub') {
      if (!sdkMock.createOpencodeClient) throw new Error('createOpencodeClient mock not installed');
      return sdkMock.createOpencodeClient(opts);
    }
    if (sdkMock.liveClient === null) throw new Error('no live server was started');
    return sdkMock.liveClient;
  },
}));

// The adapter spawns its per-session server through the owned serve helper (CODE-76), then builds
// the client separately — bridge that spawn back onto the `createOpencode`-shaped mock the cases
// install, so each case keeps stubbing one function that yields both client and server.
vi.mock('../native/opencode/serve', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  async startOpencodeServe(opts: unknown) {
    if (!sdkMock.createOpencode) throw new Error('createOpencode mock not installed');
    const started = (await sdkMock.createOpencode(opts)) as {
      client: unknown;
      server: { url?: string; close(): void };
    };
    sdkMock.liveClient = started.client;
    return { url: started.server.url ?? 'http://fake', close: () => started.server.close() };
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

function toolPart(id: string, tool: string) {
  return {
    id,
    sessionID: 'ses-1',
    messageID: 'msg-a1',
    type: 'tool',
    callID: `call-${id}`,
    tool,
    state: { status: 'completed', input: {}, output: 'ok', time: { start: 0, end: 1 } },
  };
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

describe('OpenCodeAdapter.startCatalog', () => {
  it('advertises selectable agents as policies and reachable models, scoped to the cwd', async () => {
    const list = vi.fn(() =>
      Promise.resolve({
        data: {
          connected: ['anthropic'],
          all: [
            { id: 'anthropic', name: 'Anthropic', models: { 'claude-opus-5': { name: 'Opus 5' } } },
            { id: 'offline', name: 'Offline', source: 'env', models: { 'some-model': {} } },
          ],
        },
      }),
    );
    const agents = vi.fn(() =>
      Promise.resolve({
        data: [
          { name: 'plan', mode: 'primary', description: 'Read-only' },
          { name: 'build', mode: 'primary' },
          { name: 'title', mode: 'primary', hidden: true },
          { name: 'reviewer', mode: 'subagent' },
        ],
      }),
    );
    sdkMock.createOpencodeClient = () => ({ provider: { list }, app: { agents } });

    const catalog = await new HistoryTestAdapter().startCatalog({ cwd: '/tmp/repo' });
    expect(list).toHaveBeenCalledWith({ directory: '/tmp/repo' });
    expect(agents).toHaveBeenCalledWith({ directory: '/tmp/repo' });
    expect(catalog.models).toEqual([
      { id: 'anthropic/claude-opus-5', label: 'Opus 5', description: 'Anthropic' },
    ]);
    // Hidden primaries and subagents are not personas a user runs a turn under.
    expect(catalog.policies.map((p) => p.policyId)).toEqual(['plan', 'build']);
    expect(catalog.defaultPolicyId).toBe('plan');
  });

  it('leaves each axis empty when its read fails, rather than blocking the new-session surface', async () => {
    sdkMock.createOpencodeClient = () => ({
      provider: { list: vi.fn(() => Promise.resolve({ error: { message: 'boom' } })) },
      app: { agents: vi.fn(() => Promise.resolve({ error: { message: 'boom' } })) },
    });

    await expect(new HistoryTestAdapter().startCatalog({ cwd: '/tmp/repo' })).resolves.toEqual({
      models: [],
      policies: [],
    });
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
      config: { get: vi.fn(() => Promise.resolve({ data: {} })) },
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
      type: 'agent-message',
      messageId: 'prt-a1',
    });
    expect(page2.cursor).toBeUndefined();
  });

  it('retitles MCP tools from the engine hint and config-declared servers alike', async () => {
    const assistant = {
      info: { id: 'msg-a1', sessionID: 'ses-1', role: 'assistant', time: { created: 20 } },
      parts: [
        // Engine-injected server (simulator endpoint) — absent from the session's config.
        toolPart('prt-t1', 'linkcode-sim_sim_tap'),
        // Config-declared server — resolved without any hint.
        toolPart('prt-t2', 'notion_search_pages'),
        toolPart('prt-t3', 'bash'),
      ],
    };
    sdkMock.createOpencodeClient = () => ({
      session: {
        get: vi.fn(() => Promise.resolve({ data: makeSession() })),
        messages: vi.fn(() => Promise.resolve({ data: [assistant] })),
      },
      config: { get: vi.fn(() => Promise.resolve({ data: { mcp: { notion: {} } } })) },
    });

    const result = await new HistoryTestAdapter().readHistory({
      historyId: 'ses-1' as AgentHistoryId,
      mcpServerNames: ['linkcode-sim'],
    });
    const titles = result.events.map((e) =>
      e.event.type === 'tool-call' ? e.event.toolCall.title : e.event.type,
    );
    expect(titles).toEqual(['mcp__linkcode-sim__sim_tap', 'mcp__notion__search_pages', 'bash']);
  });

  it('keeps the transcript readable when the config read rejects (fetch throws on a dead server)', async () => {
    const assistant = {
      info: { id: 'msg-a1', sessionID: 'ses-1', role: 'assistant', time: { created: 20 } },
      parts: [
        toolPart('prt-t1', 'linkcode-sim_sim_tap'),
        toolPart('prt-t2', 'notion_search_pages'),
      ],
    };
    sdkMock.createOpencodeClient = () => ({
      session: {
        get: vi.fn(() => Promise.resolve({ data: makeSession() })),
        messages: vi.fn(() => Promise.resolve({ data: [assistant] })),
      },
      config: { get: vi.fn(() => Promise.reject(new TypeError('fetch failed'))) },
    });

    const result = await new HistoryTestAdapter().readHistory({
      historyId: 'ses-1' as AgentHistoryId,
      mcpServerNames: ['linkcode-sim'],
    });
    const titles = result.events.map((e) =>
      e.event.type === 'tool-call' ? e.event.toolCall.title : e.event.type,
    );
    // The engine hint still resolves; the config-declared server degrades to its raw title.
    expect(titles).toEqual(['mcp__linkcode-sim__sim_tap', 'notion_search_pages']);
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
    config: { get: vi.fn(() => Promise.resolve({ data: {} })) },
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
    const client = makeLiveClient(
      makeSession({ id: 'ses-9', directory: '/tmp/original', title: 'Existing session title' }),
    );
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
    expect(events).toContainEqual({ type: 'title-update', title: 'Existing session title' });
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

describe('OpenCodeAdapter.branchHistory', () => {
  it('forks before the cursor prompt in the source canonical directory and starts the child', async () => {
    const source = makeSession({ id: 'ses-source', directory: '/canonical/repo' });
    const child = makeSession({
      id: 'ses-child',
      parentID: 'ses-source',
      directory: source.directory,
    });
    const fork = vi.fn(() => Promise.resolve({ data: child }));
    sdkMock.createOpencodeClient = () => ({
      session: {
        get: vi.fn(() => Promise.resolve({ data: source })),
        fork,
      },
    });
    const client = makeLiveClient(child);
    sdkMock.createOpencode = () =>
      Promise.resolve({ client, server: { url: 'http://fake', close: vi.fn() } });

    const adapter = new HistoryTestAdapter();
    adapter.onEvent(noop);
    await adapter.branchHistory(
      {
        historyId: 'ses-source' as AgentHistoryId,
        cursor: JSON.stringify({
          version: 1,
          kind: 'opencode',
          historyId: 'ses-source',
          branchPoint: 'msg-target',
        }),
      },
      { kind: 'opencode', cwd: '/different/repo' },
    );

    expect(fork).toHaveBeenCalledWith({
      sessionID: 'ses-source',
      messageID: 'msg-target',
      directory: '/canonical/repo',
    });
    expect(client.session.create).not.toHaveBeenCalled();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'replacement' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: 'ses-child', directory: '/canonical/repo' }),
    );
  });

  it('rejects a cursor minted for another source before calling the provider', async () => {
    const get = vi.fn();
    sdkMock.createOpencodeClient = () => ({ session: { get } });
    await expect(
      new HistoryTestAdapter().branchHistory(
        {
          historyId: 'ses-source' as AgentHistoryId,
          cursor: JSON.stringify({
            version: 1,
            kind: 'opencode',
            historyId: 'ses-other',
            branchPoint: 'msg-target',
          }),
        },
        { kind: 'opencode', cwd: '/tmp/repo' },
      ),
    ).rejects.toThrow('opencode: history branch cursor does not match the source session');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('OpenCodeAdapter.resumeHistory credential injection', () => {
  it('pre-reads the recorded model so the spawn injects the right provider credential', async () => {
    const recorded = makeSession({
      id: 'ses-9',
      directory: '/tmp/original',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
    });
    sdkMock.createOpencodeClient = () => ({
      session: { get: vi.fn(() => Promise.resolve({ data: recorded })) },
    });
    const client = makeLiveClient(recorded);
    const spawns: unknown[] = [];
    sdkMock.createOpencode = (opts: unknown) => {
      spawns.push(opts);
      return Promise.resolve({ client, server: { url: 'http://fake', close: vi.fn() } });
    };

    const adapter = new HistoryTestAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.resumeHistory(
      { historyId: 'ses-9' as AgentHistoryId },
      { kind: 'opencode', cwd: '/tmp/elsewhere', config: { apiKey: 'sk-live' } },
    );

    // The spawn already carries the resumed provider's credential, not an empty config.
    expect(spawns[0]).toMatchObject({
      config: { provider: { anthropic: { options: { apiKey: 'sk-live' } } } },
    });
    expect(
      events.some((e) => e.type === 'model-update' && e.model === 'anthropic/claude-sonnet-4-5'),
    ).toBe(true);

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'go' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      }),
    );
  });

  it('falls back to spawning without injection when the record cannot be read', async () => {
    sdkMock.createOpencodeClient = () => ({
      session: { get: vi.fn(() => Promise.reject(new Error('history server down'))) },
    });
    const client = makeLiveClient(makeSession({ id: 'ses-9', directory: '/tmp/original' }));
    const spawns: unknown[] = [];
    sdkMock.createOpencode = (opts: unknown) => {
      spawns.push(opts);
      return Promise.resolve({ client, server: { url: 'http://fake', close: vi.fn() } });
    };

    const adapter = new HistoryTestAdapter();
    adapter.onEvent(noop);
    await adapter.resumeHistory(
      { historyId: 'ses-9' as AgentHistoryId },
      { kind: 'opencode', cwd: '/tmp/elsewhere', config: { apiKey: 'sk-live' } },
    );

    expect((spawns[0] as { config?: unknown }).config).toBeUndefined();
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
