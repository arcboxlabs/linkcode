import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { CodexAdapter } from '../native/codex';
import type { CodexServerHandle } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

/** Minimal fake satisfying `CodexServerHandle` — narrower than `normalize.test.ts`'s
 * `FakeCodexServer` (not exported): a request log, a per-method response hook, and the
 * notification/exit callbacks the adapter registers through `startAppServer`'s options. */
class FakeCodexServer {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  /** Set per test to reject a specific method like a JSON-RPC error response. */
  rejectMethod: string | undefined;
  constructor(private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>) {}
  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params: params as Record<string, unknown> });
    if (method === this.rejectMethod) {
      return Promise.reject(Object.assign(new Error('codex: invalid request'), { code: -32600 }));
    }
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve({ thread: { id: 'thread-1' } });
    }
    return Promise.resolve({});
  }
  setRequestHandler(): void {
    // Approvals never fire on the shell-command path.
  }
  close(): void {
    // Nothing to reap.
  }
  notify(method: string, params: unknown): void {
    this.opts.onNotification(method, params);
  }
}

class TestCodex extends CodexAdapter {
  fakeServers: FakeCodexServer[] = [];
  protected override startAppServer(
    opts: Omit<CodexAppServerOptions, 'binaryPath'>,
  ): Promise<CodexServerHandle> {
    const server = new FakeCodexServer(opts);
    this.fakeServers.push(server);
    return Promise.resolve(server);
  }
  protected override readConfiguredSandbox() {
    return Promise.resolve(undefined);
  }
}

const start: StartOptions = { kind: 'codex', cwd: '/repo' };

/** Drives the verified live notification sequence for a shell command that ran to completion:
 * status running → turn/started → item/started → item/completed → turn/completed. */
function driveShellTurn(
  server: FakeCodexServer,
  opts: { itemId: string; turnId: string; itemStatus: 'completed' | 'failed'; exitCode: number },
): void {
  server.notify('thread/status/changed', { status: 'active' });
  server.notify('turn/started', { turn: { id: opts.turnId } });
  server.notify('item/started', {
    item: {
      type: 'commandExecution',
      id: opts.itemId,
      command: 'echo hi',
      cwd: '/repo',
      status: 'inProgress',
      source: 'userShell',
    },
  });
  server.notify('item/completed', {
    item: {
      type: 'commandExecution',
      id: opts.itemId,
      command: 'echo hi',
      cwd: '/repo',
      status: opts.itemStatus,
      source: 'userShell',
      aggregatedOutput: 'hi\n',
      exitCode: opts.exitCode,
    },
  });
  server.notify('turn/completed', { turn: { id: opts.turnId, status: 'completed' } });
  server.notify('thread/status/changed', { status: 'idle' });
}

describe('CodexAdapter shell-command passthrough', () => {
  it('sends thread/shellCommand with the started thread id and the command', async () => {
    const adapter = new TestCodex();
    await adapter.start(start);
    await adapter.send({ type: 'shell-command', command: 'echo hi' });

    const server = adapter.fakeServers[0];
    const shellRequest = server.requests.find((r) => r.method === 'thread/shellCommand');
    expect(shellRequest?.params).toEqual({ threadId: 'thread-1', command: 'echo hi' });
  });

  it('folds the verified notification sequence into running status, an execute tool card, and stop+idle', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);
    events.length = 0; // Drop the starting/idle noise from `start`.

    await adapter.send({ type: 'shell-command', command: 'echo hi' });
    const server = adapter.fakeServers[0];
    driveShellTurn(server, {
      itemId: 'item-1',
      turnId: 'turn-1',
      itemStatus: 'completed',
      exitCode: 0,
    });

    const statuses = events.reduce<string[]>((acc, e) => {
      if (e.type === 'status') acc.push(e.status);
      return acc;
    }, []);
    expect(statuses).toEqual(['running', 'idle']);

    const toolEvents = events.filter((e) => e.type === 'tool-call');
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0].toolCall).toMatchObject({
      toolCallId: 'item-1',
      kind: 'execute',
      status: 'in_progress',
    });
    expect(toolEvents[1].toolCall).toMatchObject({
      toolCallId: 'item-1',
      kind: 'execute',
      status: 'completed',
      rawOutput: 0,
    });
    expect(toolEvents[1].toolCall.content).toEqual([
      { type: 'content', content: { type: 'text', text: 'hi\n' } },
    ]);

    const stop = events.find((e) => e.type === 'stop');
    expect(stop?.stopReason).toBe('end_turn');
  });

  it('folds a failed item (turn still completes) into a failed tool call', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);
    events.length = 0;

    await adapter.send({ type: 'shell-command', command: 'false' });
    const server = adapter.fakeServers[0];
    driveShellTurn(server, {
      itemId: 'item-2',
      turnId: 'turn-2',
      itemStatus: 'failed',
      exitCode: 7,
    });

    const toolEvents = events.filter((e) => e.type === 'tool-call');
    const settled = toolEvents.at(-1);
    expect(settled?.toolCall).toMatchObject({
      toolCallId: 'item-2',
      status: 'failed',
      rawOutput: 7,
    });

    // turn/completed's status is always 'completed' regardless of the item's failure — the turn
    // still resolves to end_turn, not an error.
    const stop = events.find((e) => e.type === 'stop');
    expect(stop?.stopReason).toBe('end_turn');
  });

  it('rejects send() when the app-server returns a JSON-RPC error', async () => {
    const adapter = new TestCodex();
    await adapter.start(start);
    adapter.fakeServers[0].rejectMethod = 'thread/shellCommand';

    await expect(adapter.send({ type: 'shell-command', command: 'echo hi' })).rejects.toThrow(
      'codex: invalid request',
    );
  });

  it('still emits session-ref when a fresh thread’s first action is a shell command', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);

    // A fresh thread defers session-ref past thread/start (see openThread) — nothing announced yet.
    expect(events.some((e) => e.type === 'session-ref')).toBe(false);

    await adapter.send({ type: 'shell-command', command: 'echo hi' });
    const server = adapter.fakeServers[0];
    driveShellTurn(server, {
      itemId: 'item-3',
      turnId: 'turn-3',
      itemStatus: 'completed',
      exitCode: 0,
    });

    const sessionRef = events.find((e) => e.type === 'session-ref');
    expect(sessionRef?.historyId).toBe('thread-1');
  });
});
