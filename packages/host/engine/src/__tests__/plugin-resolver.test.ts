import type { McpPluginCatalog, PluginConfig, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { MCP_PLUGIN_CATALOG } from '../plugin/catalog';
import { resolvePluginServers } from '../session/start-options-resolver';

const PRESET_CATALOG: McpPluginCatalog = [
  {
    id: 'github-read',
    labelKey: 'units.githubRead.label',
    descriptionKey: 'units.githubRead.description',
    servers: [
      {
        type: 'preset',
        server: {
          type: 'stdio',
          name: 'linkcode-github',
          command: 'github-mcp-server',
          args: ['stdio'],
          env: { LOG_LEVEL: 'warn' },
        },
        service: 'github',
        credentialSlots: [{ target: 'env', name: 'GITHUB_TOKEN' }],
      },
      {
        type: 'preset',
        server: { type: 'http', name: 'github-docs', url: 'https://docs.test/mcp' },
        credentialSlots: [],
      },
    ],
  },
];

const LOCAL_CONFIG: PluginConfig = {
  units: [{ unitId: 'github-read', enabled: true }],
  serviceBindings: { github: { type: 'local', connectorId: 'github-personal' } },
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
  it('materializes every composed server, routing credentials through the service binding', () => {
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
          { type: 'http', name: 'github-docs', url: 'https://docs.test/mcp' },
        ],
      },
      warnings: [],
    });
    expect(PRESET_CATALOG[0]?.servers[0]).not.toHaveProperty('server.env.GITHUB_TOKEN');
  });

  it('lets a client-supplied server win by name without injecting the stored secret', () => {
    const clientServer = {
      type: 'http' as const,
      name: 'linkcode-github',
      url: 'https://client.test/github',
    };
    const resolved = resolvePluginServers(
      { ...OPTIONS, mcpServers: [clientServer] },
      { ...LOCAL_CONFIG, serviceBindings: {}, connectors: [] },
      PRESET_CATALOG,
    );

    expect(resolved).toEqual({
      options: {
        ...OPTIONS,
        mcpServers: [
          clientServer,
          { type: 'http', name: 'github-docs', url: 'https://docs.test/mcp' },
        ],
      },
      warnings: [],
    });
    expect(JSON.stringify(resolved)).not.toContain('github-secret');
  });

  it('degrades an unsatisfied service dependency to a warning without dropping satisfied servers', () => {
    const resolved = resolvePluginServers(
      OPTIONS,
      { ...LOCAL_CONFIG, serviceBindings: {} },
      PRESET_CATALOG,
    );

    expect(resolved.warnings).toEqual([
      {
        type: 'plugin-warning',
        unitId: 'github-read',
        service: 'github',
        reason: 'unsatisfied-binding',
      },
    ]);
    expect(resolved.options.mcpServers).toEqual([
      { type: 'http', name: 'github-docs', url: 'https://docs.test/mcp' },
    ]);
  });

  it('skips a declaredly expired credential with a typed reason instead of injecting it', () => {
    const resolved = resolvePluginServers(
      OPTIONS,
      {
        ...LOCAL_CONFIG,
        connectors: [
          {
            id: 'github-personal',
            service: 'github',
            credential: { type: 'auth-token', secret: 'github-secret', expiresAt: 999 },
          },
        ],
      },
      PRESET_CATALOG,
      1000,
    );

    expect(resolved.warnings).toEqual([
      {
        type: 'plugin-warning',
        unitId: 'github-read',
        service: 'github',
        reason: 'expired-credential',
      },
    ]);
    expect(JSON.stringify(resolved.options)).not.toContain('github-secret');
  });

  it('treats a service-mismatched connector as unsatisfied', () => {
    const resolved = resolvePluginServers(
      OPTIONS,
      {
        ...LOCAL_CONFIG,
        connectors: [
          {
            id: 'github-personal',
            // @ts-expect-error -- future service value simulated for the mismatch path
            service: 'jira',
            credential: { type: 'auth-token', secret: 'jira-secret' },
          },
        ],
      },
      PRESET_CATALOG,
    );

    expect(resolved.warnings).toEqual([
      {
        type: 'plugin-warning',
        unitId: 'github-read',
        service: 'github',
        reason: 'unsatisfied-binding',
      },
    ]);
    expect(JSON.stringify(resolved.options)).not.toContain('jira-secret');
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
        units: [{ unitId: 'github-read', enabled: true }],
        serviceBindings: { github: { type: 'managed' } },
        connectors: [],
      },
      MCP_PLUGIN_CATALOG,
    );
    expect(resolved.warnings).toEqual([
      {
        type: 'plugin-warning',
        unitId: 'github-read',
        service: 'github',
        reason: 'broker-unavailable',
      },
    ]);
  });
});
