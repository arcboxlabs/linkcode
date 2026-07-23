import type { McpPluginCatalog, PluginConfigPublic } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { MCP_APPLICABLE_AGENTS, pluginServiceViews, pluginUnitViews } from '../view';

const NOW = 1_000_000;

const CATALOG: McpPluginCatalog = [
  {
    id: 'github-read',
    labelKey: 'units.githubRead.label',
    descriptionKey: 'units.githubRead.description',
    servers: [
      {
        type: 'preset',
        server: { type: 'stdio', name: 'github-cli', command: 'github-mcp-server' },
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

function config(overrides: Partial<PluginConfigPublic> = {}): PluginConfigPublic {
  return {
    units: [{ unitId: 'github-read', enabled: true }],
    serviceBindings: { github: { type: 'local', connectorId: 'github-personal' } },
    connectors: [
      {
        id: 'github-personal',
        service: 'github',
        credential: { type: 'auth-token', configured: true },
      },
    ],
    customServers: [],
    ...overrides,
  };
}

describe('pluginUnitViews', () => {
  it('marks a fully satisfied composition ready and lists its distinct services', () => {
    const [unit] = pluginUnitViews(CATALOG, config(), NOW);
    expect(unit).toMatchObject({
      id: 'github-read',
      enabled: true,
      services: ['github'],
      status: 'ready',
      servers: [
        { name: 'github-cli', service: 'github', status: 'satisfied' },
        { name: 'github-docs', service: undefined, status: 'ready' },
      ],
    });
  });

  it('degrades to partial when one service dependency is unbound', () => {
    const [unit] = pluginUnitViews(CATALOG, config({ serviceBindings: {} }), NOW);
    expect(unit?.status).toBe('partial');
    expect(unit?.servers[0]?.status).toBe('unsatisfied-binding');
    expect(unit?.servers[1]?.status).toBe('ready');
  });

  it('treats a binding to a missing or service-mismatched connector as unsatisfied', () => {
    const [unit] = pluginUnitViews(CATALOG, config({ connectors: [] }), NOW);
    expect(unit?.servers[0]?.status).toBe('unsatisfied-binding');
  });

  it('flags an expired local credential without hiding the unit', () => {
    const expired = config({
      connectors: [
        {
          id: 'github-personal',
          service: 'github',
          credential: { type: 'auth-token', configured: true, expiresAt: NOW - 1 },
        },
      ],
    });
    const [unit] = pluginUnitViews(CATALOG, expired, NOW);
    expect(unit?.servers[0]?.status).toBe('expired-credential');
    expect(unit?.status).toBe('partial');
  });

  it('routes managed bindings and managed servers to the broker-unavailable state', () => {
    const managedBinding = config({ serviceBindings: { github: { type: 'managed' } } });
    expect(pluginUnitViews(CATALOG, managedBinding, NOW)[0]?.servers[0]?.status).toBe(
      'broker-unavailable',
    );

    const managedCatalog: McpPluginCatalog = [
      {
        id: 'github-read',
        labelKey: 'units.githubRead.label',
        descriptionKey: 'units.githubRead.description',
        servers: [{ type: 'managed', name: 'linkcode-github', service: 'github' }],
      },
    ];
    const [unit] = pluginUnitViews(managedCatalog, config(), NOW);
    expect(unit?.servers[0]?.status).toBe('broker-unavailable');
    expect(unit?.status).toBe('unavailable');
  });

  it('reports a unit absent from config as disabled', () => {
    const [unit] = pluginUnitViews(CATALOG, config({ units: [] }), NOW);
    expect(unit?.status).toBe('disabled');
    expect(unit?.enabled).toBe(false);
  });
});

describe('pluginServiceViews', () => {
  it('derives one row per catalog service with its binding status and dependent units', () => {
    expect(pluginServiceViews(CATALOG, config(), NOW)).toEqual([
      {
        service: 'github',
        status: {
          kind: 'local',
          connector: {
            id: 'github-personal',
            service: 'github',
            credential: { type: 'auth-token', configured: true },
          },
          expired: false,
        },
        usedByUnits: ['github-read'],
      },
    ]);
  });

  it('surfaces a dangling local binding as local-missing', () => {
    const [row] = pluginServiceViews(CATALOG, config({ connectors: [] }), NOW);
    expect(row?.status).toEqual({ kind: 'local-missing', connectorId: 'github-personal' });
  });

  it('reports an unbound service', () => {
    const [row] = pluginServiceViews(CATALOG, config({ serviceBindings: {} }), NOW);
    expect(row?.status).toEqual({ kind: 'unbound' });
  });
});

describe('MCP_APPLICABLE_AGENTS', () => {
  it('mirrors the shared schema capability table', () => {
    expect(MCP_APPLICABLE_AGENTS).toEqual(['claude-code', 'codex', 'opencode']);
  });
});
