import type { PluginProviderAdapterFactory } from '@linkcode/agent-adapter';
import type { CustomMcpServer, McpServer, PluginProvider, SessionId } from '@linkcode/schema';
import { PluginSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { CustomMcpServerService } from '../agent/custom-mcp-service';
import { InMemoryProviderConfigStore } from '../agent/provider-config';
import { PluginService } from '../plugin/service';
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

function customService(...servers: CustomMcpServer[]): CustomMcpServerService {
  const store = new InMemoryProviderConfigStore();
  store.setCustomMcpServers(servers);
  return new CustomMcpServerService(store);
}

function customEntry(name: string, enabled = true): CustomMcpServer {
  return {
    id: `custom-${name}`,
    enabled,
    server: { type: 'stdio', name, command: `${name}-mcp`, env: { TOKEN: 'secret' } },
    createdAt: 1,
  };
}

function pluginServiceWithMcp(name: string): PluginService {
  const factory: PluginProviderAdapterFactory = (provider: PluginProvider) => ({
    provider,
    list: () =>
      Promise.resolve(
        provider === 'codex'
          ? [
              PluginSchema.parse({
                provider,
                id: 'tools@market',
                name: 'tools',
                keywords: [],
                availability: 'available',
                installations: [{ enabled: true }],
                components: [{ kind: 'mcp-server', name }],
                assets: [],
                managementCapabilities: {
                  install: true,
                  uninstall: true,
                  update: false,
                  enable: true,
                  disable: true,
                },
              }),
            ]
          : [],
      ),
    listEnabledMcpServerNames: () => Promise.resolve(provider === 'codex' ? [name] : []),
    listStandaloneSkills: () => Promise.resolve([]),
  });
  return new PluginService(factory);
}

const failingMcpPreflightFactory: PluginProviderAdapterFactory = (provider) => ({
  provider,
  list: () => Promise.resolve([]),
  listEnabledMcpServerNames: () => Promise.reject(new Error('plugin detail unavailable')),
  listStandaloneSkills: () => Promise.resolve([]),
});

function pluginServiceWithFailedMcpPreflight(): PluginService {
  return new PluginService(failingMcpPreflightFactory);
}

describe('simulator MCP injection at session start', () => {
  it('appends the session endpoint for MCP-capable agents', async () => {
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(ENDPOINT),
    );
    const { options: resolved, warnings } = await Effect.runPromise(
      resolver.resolve({ kind: 'claude-code', cwd: '/repo' }, SESSION),
    );
    expect(resolved.mcpServers).toEqual([ENDPOINT]);
    expect(warnings).toEqual([]);
  });

  it('preserves explicitly requested servers ahead of the injected one', async () => {
    const explicit: McpServer = { type: 'http', name: 'custom', url: 'http://127.0.0.1:9/x' };
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(ENDPOINT),
    );
    const { options: resolved } = await Effect.runPromise(
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
    const { options: resolved } = await Effect.runPromise(
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
    expect(pi.options.mcpServers).toBeUndefined();

    const unavailable = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(undefined),
    );
    const { options: resolved } = await Effect.runPromise(
      unavailable.resolve({ kind: 'claude-code', cwd: '/repo' }, SESSION),
    );
    expect(resolved.mcpServers).toBeUndefined();
  });
});

describe('custom MCP injection at session start', () => {
  it('folds enabled custom servers in for claude-code, codex, and opencode', async () => {
    for (const kind of ['claude-code', 'codex', 'opencode'] as const) {
      const resolver = new SessionStartOptionsResolver(
        new InMemoryProviderConfigStore(),
        undefined,
        undefined,
        customService(customEntry('github'), customEntry('disabled-one', false)),
      );
      const { options: resolved, warnings } = await Effect.runPromise(
        resolver.resolve({ kind, cwd: '/repo' }, SESSION),
      );
      expect(resolved.mcpServers).toEqual([customEntry('github').server]);
      expect(warnings).toEqual([]);
    }
  });

  it('warns instead of injecting for an MCP-incapable agent', async () => {
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      undefined,
      customService(customEntry('github')),
    );
    const { options: resolved, warnings } = await Effect.runPromise(
      resolver.resolve({ kind: 'pi', cwd: '/repo' }, SESSION),
    );
    expect(resolved.mcpServers).toBeUndefined();
    expect(warnings).toEqual([{ serverName: 'github', reason: 'agent-unsupported' }]);
  });

  it('skips a caller-claimed name with a name-conflict warning', async () => {
    const explicit: McpServer = { type: 'http', name: 'github', url: 'http://127.0.0.1:9/x' };
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      undefined,
      customService(customEntry('github'), customEntry('search')),
    );
    const { options: resolved, warnings } = await Effect.runPromise(
      resolver.resolve({ kind: 'claude-code', cwd: '/repo', mcpServers: [explicit] }, SESSION),
    );
    expect(resolved.mcpServers).toEqual([explicit, customEntry('search').server]);
    expect(warnings).toEqual([{ serverName: 'github', reason: 'name-conflict' }]);
  });

  it('injects custom servers before the simulator endpoint without disturbing it', async () => {
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      provider(ENDPOINT),
      customService(customEntry('github')),
    );
    const { options: resolved, warnings } = await Effect.runPromise(
      resolver.resolve({ kind: 'claude-code', cwd: '/repo' }, SESSION),
    );
    expect(resolved.mcpServers).toEqual([customEntry('github').server, ENDPOINT]);
    expect(warnings).toEqual([]);
  });

  it('skips Codex-incompatible headers and enabled plugin MCP name conflicts', async () => {
    const headered: CustomMcpServer = {
      id: 'custom-headered',
      enabled: true,
      createdAt: 1,
      server: {
        type: 'http',
        name: 'private-api',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'secret' },
      },
    };
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      undefined,
      customService(headered, customEntry('plugin-tools'), customEntry('safe')),
      pluginServiceWithMcp('plugin-tools'),
    );

    const { options, warnings } = await Effect.runPromise(
      resolver.resolve({ kind: 'codex', cwd: '/repo' }, SESSION),
    );

    expect(options.mcpServers).toEqual([customEntry('safe').server]);
    expect(warnings).toEqual([
      { serverName: 'private-api', reason: 'provider-unsupported' },
      { serverName: 'plugin-tools', reason: 'name-conflict' },
    ]);
  });

  it('preserves absent MCP config when strict Codex plugin preflight is incomplete', async () => {
    const resolver = new SessionStartOptionsResolver(
      new InMemoryProviderConfigStore(),
      undefined,
      undefined,
      customService(customEntry('github')),
      pluginServiceWithFailedMcpPreflight(),
    );

    const { options, warnings } = await Effect.runPromise(
      resolver.resolve({ kind: 'codex', cwd: '/repo' }, SESSION),
    );

    expect(options.mcpServers).toBeUndefined();
    expect(warnings).toEqual([{ serverName: 'github', reason: 'provider-preflight-failed' }]);
  });
});
