import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { CodexAdapter } from '../native/codex';
import type { CodexServerHandle } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

/** Minimal fake satisfying `CodexServerHandle`, same shape as codex-compaction.test.ts's. */
class FakeCodexServer {
  constructor(private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>) {}
  request(method: string): Promise<unknown> {
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve({ thread: { id: 'thread-1' } });
    }
    return Promise.resolve({});
  }
  setRequestHandler(): void {
    // Approvals never fire on this path.
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

function toolTitles(events: AgentEvent[]) {
  return events.flatMap((event) => (event.type === 'tool-call' ? [event.toolCall.title] : []));
}

describe('CodexAdapter mcpToolCall items', () => {
  it('emits the shared mcp slug and strips the codex_apps plugin namespace', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);
    const server = adapter.fakeServers[0];

    server.notify('turn/started', { turn: { id: 'turn-1' } });
    // Real 0.144.6 shape: plugin apps mount under ONE `codex_apps` server, plugin in the tool name.
    server.notify('item/started', {
      item: {
        type: 'mcpToolCall',
        id: 'mcp-1',
        server: 'codex_apps',
        tool: 'linear.list_issues',
        status: 'inProgress',
        arguments: { limit: 50 },
      },
    });
    server.notify('item/started', {
      item: { type: 'mcpToolCall', id: 'mcp-2', server: 'context7', tool: 'resolve_library' },
    });
    server.notify('item/started', {
      item: { type: 'mcpToolCall', id: 'mcp-3', server: 'codex_apps', tool: 'dotless' },
    });
    // Codex accepts `__` in server names; the slug would mis-split, so the raw title survives.
    server.notify('item/started', {
      item: { type: 'mcpToolCall', id: 'mcp-4', server: 'repo__prod', tool: 'search_files' },
    });
    server.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });

    // Announce + teardown settle both re-emit the full snapshot; the title must be stable.
    expect([...new Set(toolTitles(events))]).toEqual([
      'mcp__linear__list_issues',
      'mcp__context7__resolve_library',
      'mcp__codex_apps__dotless',
      'repo__prod.search_files',
    ]);
  });
});
