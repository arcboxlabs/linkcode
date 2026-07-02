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

  it('seeds a rich streaming showcase conversation', async () => {
    const client = await connectedClient();

    const sessions = await client.listSessions();
    const showcase = sessions.find((session) => session.title === 'Mocked streaming showcase');
    expect(showcase).toMatchObject({ status: 'running' });
    if (!showcase) throw new Error('showcase session not found');

    const events = collectEvents(client, showcase.sessionId);
    const initialTools = toolCalls(events);
    const terminalTool = initialTools.find((tool) =>
      tool.content.some((content) => content.type === 'terminal'),
    );
    const terminalId = terminalTool?.content.find(
      (content) => content.type === 'terminal',
    )?.terminalId;
    expect(terminalId).toBeTruthy();

    let terminalOutput = '';
    if (terminalId) {
      client.subscribeTerminalOutput(terminalId, (data) => {
        terminalOutput += data;
      });
    }

    await wait(1500);

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

    const permission = events.find((event) => event.type === 'permission-request');
    if (permission?.type !== 'permission-request') throw new Error('permission request not found');
    await expect(
      client.respondPermission(showcase.sessionId, permission.requestId, {
        outcome: 'selected',
        optionId: 'allow_once',
      }),
    ).resolves.toEqual({ ok: true });
    expect(
      toolCalls(events).some(
        (tool) => tool.toolCallId === permission.toolCall.toolCallId && tool.status === 'completed',
      ),
    ).toBe(true);

    client.dispose();
  });

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
