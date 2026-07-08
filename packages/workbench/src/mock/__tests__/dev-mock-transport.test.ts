import { LinkCodeClient } from '@linkcode/client-core';
import type { AgentEvent, ProvidersConfig, SessionId, ToolCall } from '@linkcode/schema';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import { createDevMockTransport } from '../dev-mock-transport';

async function connectedClient(): Promise<LinkCodeClient> {
  const client = new LinkCodeClient(createDevMockTransport());
  await client.connect();
  return client;
}

function collectEvents(client: LinkCodeClient, sessionId: SessionId): AgentEvent[] {
  const events: AgentEvent[] = [];
  client.subscribe(sessionId, (event) => events.push(event));
  return events;
}

function toolCalls(events: readonly AgentEvent[]): ToolCall[] {
  return events.flatMap((event) => (event.type === 'tool-call' ? [event.toolCall] : []));
}

async function eventually<T>(
  read: () => T | false | null | undefined,
  timeoutMs = 5000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value) return value;
    // eslint-disable-next-line no-await-in-loop -- polling: each check must wait out the interval
    await wait(50);
  }
  throw new Error('timed out waiting for mock event');
}

describe('dev mock transport', () => {
  it('drives the current workbench data plane without a daemon', async () => {
    const client = await connectedClient();

    const seeded = await client.listSessions();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.some((session) => session.status === 'stopped')).toBe(true);

    const sessionId = await client.startSession({
      kind: 'codex',
      cwd: '/mock/repo',
      model: 'mock-model-large',
    });
    const sessions = await client.listSessions();
    expect(sessions).toHaveLength(seeded.length + 1);
    expect(sessions.find((session) => session.sessionId === sessionId)).toMatchObject({
      kind: 'codex',
      cwd: '/mock/repo',
      status: 'idle',
    });

    const events = collectEvents(client, sessionId);
    await client.promptText(sessionId, 'Hello mocked daemon');

    expect(events.some((event) => event.type === 'user-message')).toBe(true);
    expect(events.some((event) => event.type === 'agent-thought-chunk')).toBe(true);
    expect(events.some((event) => event.type === 'token-usage')).toBe(true);
    expect(events.some((event) => event.type === 'stop' && event.stopReason === 'end_turn')).toBe(
      true,
    );

    // The reply streams as many chunks (one bubble via a shared messageId) and echoes the model.
    const chunks = events.filter((event) => event.type === 'agent-message-chunk');
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((chunk) => chunk.messageId)).size).toBe(1);
    const replyText = chunks
      .map((chunk) => ('text' in chunk.content ? chunk.content.text : ''))
      .join('');
    expect(replyText).toContain('mock-model-large');
    expect(replyText).toContain('Hello mocked daemon');

    const providers = {
      codex: { enabled: true, defaultModel: 'mock-model' },
    } satisfies ProvidersConfig;
    await client.setProviderConfig(providers);
    expect(await client.getProviderConfig()).toEqual(providers);

    client.dispose();
  });

  it('answers workspace and git calls mounted by the workbench shell', async () => {
    const client = await connectedClient();

    const workspaces = await client.listWorkspaces();
    expect(workspaces.map((workspace) => workspace.cwd)).toEqual(
      expect.arrayContaining(['/mock/linkcode', '/mock/platform']),
    );

    const workspace = await client.registerWorkspace('/mock/new', 'New Mock');
    expect(workspace).toMatchObject({ cwd: '/mock/new', name: 'New Mock' });
    await expect(client.updateWorkspace(workspace.workspaceId, 'Renamed Mock')).resolves.toEqual({
      ok: true,
    });
    expect(
      (await client.listWorkspaces()).find((item) => item.workspaceId === workspace.workspaceId),
    ).toMatchObject({ name: 'Renamed Mock' });
    await expect(client.archiveWorkspace(workspace.workspaceId)).resolves.toEqual({ ok: true });
    expect(
      (await client.listWorkspaces()).some((item) => item.workspaceId === workspace.workspaceId),
    ).toBe(false);

    // Starting a session registers its directory as a workspace, like the engine's touch().
    await client.startSession({ kind: 'codex', cwd: '/mock/fresh' });
    expect((await client.listWorkspaces()).map((item) => item.cwd)).toContain('/mock/fresh');

    // Git fixtures vary by cwd: dirty repo with a troubled PR, clean repo without one, non-repo.
    await expect(client.getGitStatus('/mock/linkcode')).resolves.toMatchObject({
      isRepo: true,
      branch: 'mock-host',
      dirtyFileCount: 3,
    });
    await expect(client.getGitPullRequestStatus('/mock/linkcode')).resolves.toMatchObject({
      status: 'ok',
      pullRequest: { checks: 'failing', reviewDecision: 'changes_requested' },
    });
    await expect(client.getGitDiff('/mock/linkcode', 'uncommitted')).resolves.toMatchObject({
      truncated: false,
      stat: { files: 1, additions: 1, deletions: 1 },
    });
    await expect(client.getGitStatus('/mock/platform')).resolves.toMatchObject({
      isRepo: true,
      dirtyFileCount: 0,
    });
    await expect(client.getGitPullRequestStatus('/mock/platform')).resolves.toEqual({
      status: 'ok',
      pullRequest: null,
    });
    await expect(client.getGitStatus('/mock/scratch')).resolves.toEqual({ isRepo: false });
    await expect(client.getGitPullRequestStatus('/mock/scratch')).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_git_repo',
    });

    client.dispose();
  }, 15000);

  it('lists canned provider history and imports it as a cold session', async () => {
    const client = await connectedClient();

    const linkcode = await client.listHistory('claude-code', { cwd: '/mock/linkcode' });
    expect(linkcode.sessions.length).toBeGreaterThan(0);
    expect(
      linkcode.sessions.every(
        (entry) => entry.kind === 'claude-code' && entry.cwd === '/mock/linkcode',
      ),
    ).toBe(true);

    const platform = await client.listHistory('claude-code', { cwd: '/mock/platform' });
    expect(platform.sessions.every((entry) => entry.cwd === '/mock/platform')).toBe(true);

    const entry = linkcode.sessions[0];
    const record = await client.importSession('claude-code', entry.historyId);
    expect(record).toMatchObject({
      kind: 'claude-code',
      cwd: '/mock/linkcode',
      origin: { type: 'imported', historyId: entry.historyId },
      runs: [],
    });

    // Imported sessions are cold: listed as stopped, resumable, then promptable.
    const imported = (await client.listSessions()).find(
      (session) => session.sessionId === record.sessionId,
    );
    expect(imported).toMatchObject({ status: 'stopped', title: entry.title });
    await expect(client.resumeSession(record.sessionId)).resolves.toBe(record.sessionId);

    await expect(client.importSession('codex', entry.historyId)).rejects.toThrow(
      'Unknown history session',
    );

    client.dispose();
  });

  it('opens an echo terminal', async () => {
    const client = await connectedClient();

    const terminalId = await client.openTerminal({ cols: 80, rows: 24, cwd: '/mock/linkcode' });
    let output = '';
    client.subscribeTerminalOutput(terminalId, (data) => {
      output += data;
    });
    let exitCode: number | null | undefined;
    client.subscribeTerminalExit(terminalId, (code) => {
      exitCode = code;
    });

    client.terminalInput(terminalId, 'ls\r');
    await eventually(() => output.includes('ls'));
    expect(output).toContain('mock echo terminal');

    client.closeTerminal(terminalId);
    await eventually(() => exitCode !== undefined);
    expect(exitCode).toBe(0);

    client.dispose();
  });

  it('seeds a rich streaming showcase conversation', async () => {
    const client = await connectedClient();

    const sessions = await client.listSessions();
    const showcase = sessions.find((session) => session.title === 'Mocked streaming showcase');
    expect(showcase).toMatchObject({ status: 'running' });
    if (!showcase) throw new Error('showcase session not found');

    const events = collectEvents(client, showcase.sessionId);
    const terminalId = await eventually(() => {
      const terminalTool = toolCalls(events).find((tool) =>
        tool.content.some((content) => content.type === 'terminal'),
      );
      return terminalTool?.content.find((content) => content.type === 'terminal')?.terminalId;
    });

    let terminalOutput = '';
    client.subscribeTerminalOutput(terminalId, (data) => {
      terminalOutput += data;
    });

    // The turn stays in flight until every permission ask is answered, mirroring a live agent.
    await eventually(
      () => events.filter((event) => event.type === 'permission-request').length >= 2,
      15000,
    );
    const permissionRequests = events.filter(
      (event): event is Extract<AgentEvent, { type: 'permission-request' }> =>
        event.type === 'permission-request',
    );
    expect(permissionRequests.map((request) => request.toolCall.kind).sort()).toEqual([
      'edit',
      'execute',
    ]);
    for (const request of permissionRequests) {
      // eslint-disable-next-line no-await-in-loop -- answer the asks in order, like a user would.
      await expect(
        client.respondPermission(showcase.sessionId, request.requestId, {
          outcome: 'selected',
          optionId: 'allow_once',
        }),
      ).resolves.toEqual({ ok: true });
      expect(
        toolCalls(events).some(
          (tool) => tool.toolCallId === request.toolCall.toolCallId && tool.status === 'completed',
        ),
      ).toBe(true);
    }

    await eventually(
      () => events.some((event) => event.type === 'stop' && event.stopReason === 'end_turn'),
      15000,
    );

    expect(events.some((event) => event.type === 'user-message')).toBe(true);
    expect(events.some((event) => event.type === 'agent-thought-chunk')).toBe(true);
    expect(events.some((event) => event.type === 'plan')).toBe(true);
    expect(events.some((event) => event.type === 'permission-request')).toBe(true);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.some((event) => event.type === 'token-usage')).toBe(true);
    expect(events.some((event) => event.type === 'stop' && event.stopReason === 'end_turn')).toBe(
      true,
    );

    const tools = toolCalls(events);
    expect(tools.some((tool) => tool.content.some((content) => content.type === 'diff'))).toBe(
      true,
    );
    expect(tools.some((tool) => tool.content.some((content) => content.type === 'terminal'))).toBe(
      true,
    );
    expect(tools.some((tool) => tool.status === 'failed')).toBe(true);
    expect(terminalOutput).toContain('pnpm vitest run packages/workbench/src/mock');
    expect(terminalOutput).toContain('mock terminal stream finished');

    const streamChunks = events.filter(
      (event): event is Extract<AgentEvent, { type: 'agent-message-chunk' }> =>
        event.type === 'agent-message-chunk' && event.messageId.startsWith('mock-showcase-stream'),
    );
    expect(streamChunks.length).toBeGreaterThan(1);
    expect(new Set(streamChunks.map((chunk) => chunk.messageId)).size).toBe(1);

    client.dispose();
  }, 20000);

  it('does not resume the showcase stream inside a later user turn after cancel', async () => {
    const client = await connectedClient();
    const sessions = await client.listSessions();
    const showcase = sessions.find((session) => session.title === 'Mocked streaming showcase');
    if (!showcase) throw new Error('showcase session not found');

    const events = collectEvents(client, showcase.sessionId);
    await eventually(() => events.some((event) => event.type === 'user-message'));

    await client.cancel(showcase.sessionId);
    const prompt = 'word '.repeat(120).trim();
    const pendingPrompt = client.promptText(showcase.sessionId, prompt);
    await wait(1600);

    const strayShowcaseChunks = events.filter(
      (event) =>
        event.type === 'agent-message-chunk' && event.messageId.startsWith('mock-showcase-stream'),
    );
    expect(strayShowcaseChunks).toHaveLength(0);

    await expect(pendingPrompt).resolves.toEqual({ ok: true });
    client.dispose();
  }, 10000);

  it('cancels pending showcase permissions when the turn is stopped', async () => {
    const client = await connectedClient();
    const sessions = await client.listSessions();
    const showcase = sessions.find((session) => session.title === 'Mocked streaming showcase');
    if (!showcase) throw new Error('showcase session not found');

    const events = collectEvents(client, showcase.sessionId);
    await eventually(
      () => events.filter((event) => event.type === 'permission-request').length >= 2,
      15000,
    );
    const permissionRequests = events.filter(
      (event): event is Extract<AgentEvent, { type: 'permission-request' }> =>
        event.type === 'permission-request',
    );

    await client.cancel(showcase.sessionId);

    for (const request of permissionRequests) {
      // eslint-disable-next-line no-await-in-loop -- assert each cancelled ask reaches its own tool snapshot.
      const cancelledTool = await eventually(() =>
        toolCalls(events).find(
          (tool) => tool.toolCallId === request.toolCall.toolCallId && tool.status === 'failed',
        ),
      );
      expect(cancelledTool.rawOutput).toEqual({ outcome: { outcome: 'cancelled' } });
      // eslint-disable-next-line no-await-in-loop -- the cancelled ask must be gone from the mock permission map.
      await expect(
        client.respondPermission(showcase.sessionId, request.requestId, {
          outcome: 'selected',
          optionId: 'allow_once',
        }),
      ).rejects.toThrow('Unknown permission request');
    }

    client.dispose();
  }, 20000);

  it('cancels an in-flight prompt turn', async () => {
    const client = await connectedClient();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const events = collectEvents(client, sessionId);

    const pending = client.promptText(sessionId, 'stream me a long reply');
    await wait(300); // past the thought, into the chunk stream
    await client.cancel(sessionId);
    await expect(pending).resolves.toEqual({ ok: true });

    // No further chunks after cancel, and no end_turn stop — the turn really stopped.
    await wait(200);
    const chunksAfterCancel = events.filter((event) => event.type === 'agent-message-chunk');
    await wait(200);
    expect(events.filter((event) => event.type === 'agent-message-chunk')).toHaveLength(
      chunksAfterCancel.length,
    );
    expect(events.some((event) => event.type === 'stop' && event.stopReason === 'cancelled')).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'stop' && event.stopReason === 'end_turn')).toBe(
      false,
    );

    client.dispose();
  });

  it('forces the error path with the fail prompt', async () => {
    const client = await connectedClient();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const events = collectEvents(client, sessionId);

    await expect(client.promptText(sessionId, 'fail')).rejects.toThrow('Mock failure');
    expect(events.some((event) => event.type === 'error')).toBe(true);

    client.dispose();
  });

  it('rejects input to stopped sessions and enforces resume parity', async () => {
    const client = await connectedClient();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });

    await expect(client.resumeSession(sessionId)).rejects.toThrow('already running');

    await client.stopSession(sessionId);
    await expect(client.promptText(sessionId, 'hi')).rejects.toThrow('stopped');

    expect(await client.resumeSession(sessionId)).toBe(sessionId);
    await expect(client.promptText(sessionId, 'hi again')).resolves.toEqual({ ok: true });

    client.dispose();
  });
});
