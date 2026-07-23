import type { AgentEvent } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { CodexAdapter } from '../native/codex';
import type { CodexServerHandle } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

/** Request log + canned thread/start reply; see codex-shell.test.ts for the full-featured fake. */
class FakeCodexServer {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  constructor(private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>) {}
  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params: params as Record<string, unknown> });
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve({ thread: { id: 'thread-1' }, model: 'gpt-5.6-sol' });
    }
    return Promise.resolve({});
  }
  setRequestHandler(): void {
    // Approvals are irrelevant to this suite.
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
  protected override readConfiguredSandbox(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

describe('CodexAdapter MCP injection', () => {
  it('maps servers into thread/start config.mcp_servers alongside writable roots', async () => {
    const adapter = new TestCodex();
    await adapter.start({
      kind: 'codex',
      cwd: '/repo',
      additionalDirectories: ['/extra'],
      mcpServers: [
        {
          type: 'stdio',
          name: 'linkcode-github',
          command: 'github-mcp-server',
          args: ['stdio'],
          env: { GITHUB_TOKEN: 'secret' },
        },
        { type: 'http', name: 'docs', url: 'https://docs.test/mcp', headers: { 'X-Key': 'k' } },
      ],
    });

    const started = adapter.fakeServers[0]?.requests.find((r) => r.method === 'thread/start');
    // One shared config map: MCP servers must not evict the writable-roots override.
    expect(started?.params.config).toEqual({
      'sandbox_workspace_write.writable_roots': ['/extra'],
      mcp_servers: {
        // codex has no type tag (stdio inferred from `command`) and names headers `http_headers`.
        'linkcode-github': {
          command: 'github-mcp-server',
          args: ['stdio'],
          env: { GITHUB_TOKEN: 'secret' },
        },
        docs: { url: 'https://docs.test/mcp', http_headers: { 'X-Key': 'k' } },
      },
    });
  });

  it('omits the config override entirely when nothing needs one', async () => {
    const adapter = new TestCodex();
    await adapter.start({ kind: 'codex', cwd: '/repo' });
    const started = adapter.fakeServers[0]?.requests.find((r) => r.method === 'thread/start');
    expect(started?.params.config).toBeUndefined();
  });

  it('surfaces a failed MCP server startup as a recoverable diagnostic', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start({
      kind: 'codex',
      cwd: '/repo',
      mcpServers: [{ type: 'http', name: 'docs', url: 'https://docs.test/mcp' }],
    });

    adapter.fakeServers[0]?.notify('mcpServer/startupStatus/updated', {
      threadId: 'thread-1',
      name: 'docs',
      status: 'failed',
      error: 'connect ECONNREFUSED',
    });
    adapter.fakeServers[0]?.notify('mcpServer/startupStatus/updated', {
      threadId: 'thread-1',
      name: 'docs',
      status: 'ready',
      error: null,
    });

    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toEqual([
      {
        type: 'error',
        message: 'MCP server "docs" failed to start: connect ECONNREFUSED',
        recoverable: true,
      },
    ]);
  });
});
