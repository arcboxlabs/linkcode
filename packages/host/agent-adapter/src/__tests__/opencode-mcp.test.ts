import { describe, expect, it, vi } from 'vitest';
import { OpenCodeAdapter } from '../native/opencode';
import { FakeEventStream } from './fake-event-stream';

const sdkMock = vi.hoisted(() => ({
  createOpencode: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencode(opts: unknown) {
    if (!sdkMock.createOpencode) throw new Error('createOpencode mock not installed');
    return sdkMock.createOpencode(opts);
  },
}));

/** Just enough client for onStart to finish; see opencode.test.ts for the full-featured fake. */
class FakeClient {
  readonly stream = new FakeEventStream();
  readonly session = { create: vi.fn(() => ({ data: { id: 'sess-1' } })) };
  readonly command = { list: vi.fn(() => ({ data: [] as unknown[] })) };
  readonly app = { agents: vi.fn(() => ({ data: [] as unknown[] })) };
  readonly provider = {
    list: vi.fn(() => ({ data: { all: [] as unknown[], default: {}, connected: [] } })),
  };
  readonly event = { subscribe: vi.fn(() => ({ stream: this.stream })) };
}

async function startedConfig(opts: Record<string, unknown>): Promise<unknown> {
  let captured: unknown;
  sdkMock.createOpencode = (serverOptions: unknown) => {
    captured = serverOptions;
    return Promise.resolve({
      client: new FakeClient(),
      server: { url: 'http://fake', close: vi.fn() },
    });
  };
  const adapter = new OpenCodeAdapter();
  await adapter.start({ kind: 'opencode', cwd: '/tmp/repo', ...opts });
  return (captured as { config?: unknown } | undefined)?.config;
}

describe('OpenCodeAdapter MCP injection', () => {
  it('maps servers into the spawn-time Config.mcp with opencode field names', async () => {
    const config = await startedConfig({
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

    expect(config).toEqual({
      mcp: {
        // stdio→local with ONE concatenated command array and env renamed `environment`;
        // enabled must be explicit or a same-named user entry's `enabled: false` leaks through.
        'linkcode-github': {
          type: 'local',
          command: ['github-mcp-server', 'stdio'],
          environment: { GITHUB_TOKEN: 'secret' },
          enabled: true,
        },
        docs: {
          type: 'remote',
          url: 'https://docs.test/mcp',
          headers: { 'X-Key': 'k' },
          enabled: true,
        },
      },
    });
  });

  it('keeps credential injection and MCP config on the same spawn config', async () => {
    const config = await startedConfig({
      model: 'anthropic/claude-opus-4-8',
      config: { apiKey: 'sk-live' },
      mcpServers: [{ type: 'http', name: 'docs', url: 'https://docs.test/mcp' }],
    });

    expect(config).toEqual({
      provider: { anthropic: { options: { apiKey: 'sk-live' } } },
      mcp: {
        docs: { type: 'remote', url: 'https://docs.test/mcp', enabled: true },
      },
    });
  });

  it('spawns without a config when neither credentials nor MCP servers are present', async () => {
    expect(await startedConfig({})).toBeUndefined();
  });
});
