import type { McpServer, SessionId } from '@linkcode/schema';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { InMemoryProviderConfigStore } from '../agent/provider-config';
import { SessionStartOptionsResolver } from '../session/start-options-resolver';
import type { SimulatorMcpProvider } from '../simulator/mcp';

const SESSION = 'session-1' as SessionId;
const ENDPOINT: McpServer = {
  type: 'http',
  name: 'linkcode-sim',
  url: 'http://127.0.0.1:7777/mcp/token-1',
};

function provider(endpoint: McpServer | undefined): SimulatorMcpProvider {
  return {
    endpointFor: () => endpoint,
    release: noop,
  };
}

describe('simulator MCP injection at session start', () => {
  it('appends the session endpoint for MCP-capable agents', async () => {
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(ENDPOINT),
    );
    const resolved = await Effect.runPromise(
      resolver.resolve({ kind: 'claude-code', cwd: '/repo' }, SESSION),
    );
    expect(resolved.mcpServers).toEqual([ENDPOINT]);
  });

  it('preserves explicitly requested servers ahead of the injected one', async () => {
    const explicit: McpServer = { type: 'http', name: 'custom', url: 'http://127.0.0.1:9/x' };
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(ENDPOINT),
    );
    const resolved = await Effect.runPromise(
      resolver.resolve({ kind: 'opencode', cwd: '/repo', mcpServers: [explicit] }, SESSION),
    );
    expect(resolved.mcpServers).toEqual([explicit, ENDPOINT]);
  });

  it('does not shadow a user server that already claims the injected name', async () => {
    const userOwned: McpServer = {
      type: 'http',
      name: 'linkcode-sim',
      url: 'http://127.0.0.1:9/u',
    };
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(ENDPOINT),
    );
    const resolved = await Effect.runPromise(
      resolver.resolve({ kind: 'claude-code', cwd: '/repo', mcpServers: [userOwned] }, SESSION),
    );
    // The user's server keeps the name; ours is not appended over it.
    expect(resolved.mcpServers).toEqual([userOwned]);
  });

  it('never injects for pi, and copes with an absent capability', async () => {
    const withProvider = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(ENDPOINT),
    );
    const pi = await Effect.runPromise(withProvider.resolve({ kind: 'pi', cwd: '/repo' }, SESSION));
    expect(pi.mcpServers).toBeUndefined();

    const unavailable = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(undefined),
    );
    const resolved = await Effect.runPromise(
      unavailable.resolve({ kind: 'claude-code', cwd: '/repo' }, SESSION),
    );
    expect(resolved.mcpServers).toBeUndefined();
  });
});
