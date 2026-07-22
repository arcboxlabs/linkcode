import type { McpPluginCatalog, PluginConfig, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { MCP_PLUGIN_CATALOG } from '../plugin/catalog';
import { resolvePluginServers } from '../session/start-options-resolver';

const PRESET_CATALOG: McpPluginCatalog = [
  {
    id: 'github-read',
    labelKey: 'units.githubRead.label',
    descriptionKey: 'units.githubRead.description',
    service: 'github',
    backing: {
      type: 'preset',
      server: {
        type: 'stdio',
        name: 'linkcode-github',
        command: 'github-mcp-server',
        args: ['stdio'],
        env: { LOG_LEVEL: 'warn' },
      },
      credentialSlots: [{ target: 'env', name: 'GITHUB_TOKEN' }],
    },
  },
];

const LOCAL_CONFIG: PluginConfig = {
  units: [
    {
      unitId: 'github-read',
      enabled: true,
      binding: { type: 'local', connectorId: 'github-personal' },
    },
  ],
  connectors: [
    {
      id: 'github-personal',
      service: 'github',
      credential: { type: 'auth-token', secret: 'github-secret' },
    },
  ],
};

const OPTIONS: StartOptions = { kind: 'codex', cwd: '/repo' };

describe('resolvePluginServers', () => {
  it('materializes a preset and injects its local credential only at session start', () => {
    const resolved = resolvePluginServers(
      {
        ...OPTIONS,
        mcpServers: [{ type: 'http', name: 'client-server', url: 'https://client.test/mcp' }],
      },
      LOCAL_CONFIG,
      PRESET_CATALOG,
    );

    expect(resolved).toEqual({
      options: {
        ...OPTIONS,
        mcpServers: [
          { type: 'http', name: 'client-server', url: 'https://client.test/mcp' },
          {
            type: 'stdio',
            name: 'linkcode-github',
            command: 'github-mcp-server',
            args: ['stdio'],
            env: { LOG_LEVEL: 'warn', GITHUB_TOKEN: 'github-secret' },
          },
        ],
      },
      warnings: [],
    });
    expect(PRESET_CATALOG[0]?.backing).not.toHaveProperty('server.env.GITHUB_TOKEN');
  });

  it('lets a client-supplied server win by name without injecting the stored secret', () => {
    const clientServer = {
      type: 'http' as const,
      name: 'linkcode-github',
      url: 'https://client.test/github',
    };
    const resolved = resolvePluginServers(
      { ...OPTIONS, mcpServers: [clientServer] },
      { ...LOCAL_CONFIG, connectors: [] },
      PRESET_CATALOG,
    );

    expect(resolved).toEqual({
      options: { ...OPTIONS, mcpServers: [clientServer] },
      warnings: [],
    });
    expect(JSON.stringify(resolved)).not.toContain('github-secret');
  });

  it('reports unsupported agents instead of silently dropping an enabled unit', () => {
    const resolved = resolvePluginServers(
      { kind: 'pi', cwd: '/repo' },
      LOCAL_CONFIG,
      PRESET_CATALOG,
    );
    expect(resolved.warnings).toEqual([
      { type: 'plugin-warning', unitId: 'github-read', reason: 'unsupported-transport' },
    ]);
    expect(resolved.options.mcpServers).toBeUndefined();
  });

  it('reports the managed path as unavailable until the broker contract lands', () => {
    const resolved = resolvePluginServers(
      OPTIONS,
      {
        units: [{ unitId: 'github-read', enabled: true, binding: { type: 'managed' } }],
        connectors: [],
      },
      MCP_PLUGIN_CATALOG,
    );
    expect(resolved.warnings).toEqual([
      { type: 'plugin-warning', unitId: 'github-read', reason: 'broker-unavailable' },
    ]);
  });
});
