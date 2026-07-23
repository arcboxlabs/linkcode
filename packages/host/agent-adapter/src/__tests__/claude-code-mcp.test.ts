import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { asyncNoop, noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';

const sdkMock = vi.hoisted(() => ({
  query: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(opts: unknown) {
    if (!sdkMock.query) throw new Error('query mock not installed');
    return sdkMock.query(opts);
  },
  resolveSettings: () => Promise.resolve({ effective: {} }),
}));

// Isolate settings reads from the developer's real ~/.claude/settings.json: every read misses.
vi.mock('node:fs/promises', () => ({
  readFile: () => Promise.reject(new Error('ENOENT')),
}));

interface QueryInput {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Record<string, unknown>;
}

/** Records the options the Query was created with; the message stream stays silent. */
class FakeQuery {
  readonly options: Record<string, unknown>;
  readonly setPermissionMode = vi.fn(asyncNoop);
  readonly applyFlagSettings = vi.fn(asyncNoop);
  readonly close = vi.fn();

  constructor(input: QueryInput) {
    this.options = input.options;
    void (async () => {
      for await (const _ of input.prompt) void _;
    })();
  }

  // Silent message stream: the test only inspects creation options, so it pends forever.
  async *[Symbol.asyncIterator](): AsyncGenerator<Record<string, unknown>> {
    await new Promise(noop);
    yield {};
  }
}

const queries: FakeQuery[] = [];

sdkMock.query = (opts) => {
  const q = new FakeQuery(opts as QueryInput);
  queries.push(q);
  return q;
};

afterEach(() => {
  queries.length = 0;
});

async function startedAdapter(mcpServers?: unknown): Promise<ClaudeCodeAdapter> {
  const adapter = new ClaudeCodeAdapter();
  await adapter.start({
    kind: 'claude-code',
    cwd: '/tmp/repo',
    ...(mcpServers !== undefined && { mcpServers }),
  } as Parameters<ClaudeCodeAdapter['start']>[0]);
  await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
  return adapter;
}

describe('ClaudeCodeAdapter MCP injection', () => {
  it('folds StartOptions.mcpServers into the SDK record keyed by server name', async () => {
    await startedAdapter([
      {
        type: 'stdio',
        name: 'linkcode-github',
        command: 'github-mcp-server',
        args: ['stdio'],
        env: { GITHUB_TOKEN: 'secret' },
      },
      { type: 'http', name: 'docs', url: 'https://docs.test/mcp', headers: { 'X-Key': 'k' } },
    ]);

    expect(queries[0]?.options.mcpServers).toEqual({
      'linkcode-github': {
        type: 'stdio',
        command: 'github-mcp-server',
        args: ['stdio'],
        env: { GITHUB_TOKEN: 'secret' },
      },
      docs: { type: 'http', url: 'https://docs.test/mcp', headers: { 'X-Key': 'k' } },
    });
  });

  it('passes no mcpServers option when the session has none', async () => {
    await startedAdapter();
    expect(queries[0]?.options.mcpServers).toBeUndefined();
  });
});
