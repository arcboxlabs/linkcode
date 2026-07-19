import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { CodexAdapter } from '../native/codex';
import type { CodexServerHandle } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

/** Minimal fake satisfying `CodexServerHandle`, same shape as codex-shell.test.ts's (not exported). */
class FakeCodexServer {
  constructor(private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>) {}
  request(method: string): Promise<unknown> {
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve({ thread: { id: 'thread-1' } });
    }
    return Promise.resolve({});
  }
  setRequestHandler(): void {
    // Approvals never fire on the compaction path.
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

function compactions(events: AgentEvent[]) {
  return events.flatMap((event) => (event.type === 'compaction' ? [event] : []));
}

describe('CodexAdapter contextCompaction items', () => {
  it('maps item/started → in_progress and item/completed → completed on one compactionId', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);
    const server = adapter.fakeServers[0];

    server.notify('turn/started', { turn: { id: 'turn-1' } });
    server.notify('item/started', { item: { type: 'contextCompaction', id: 'compact-1' } });
    server.notify('item/completed', { item: { type: 'contextCompaction', id: 'compact-1' } });
    server.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });

    expect(compactions(events)).toEqual([
      { type: 'compaction', compactionId: 'compact-1', status: 'in_progress' },
      { type: 'compaction', compactionId: 'compact-1', status: 'completed' },
    ]);
  });

  it('settles a compaction whose item/completed never arrived when the turn tears down', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);
    const server = adapter.fakeServers[0];

    server.notify('turn/started', { turn: { id: 'turn-1' } });
    server.notify('item/started', { item: { type: 'contextCompaction', id: 'compact-1' } });
    server.notify('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } });

    expect(compactions(events)).toEqual([
      { type: 'compaction', compactionId: 'compact-1', status: 'in_progress' },
      { type: 'compaction', compactionId: 'compact-1', status: 'completed' },
    ]);
  });
});
