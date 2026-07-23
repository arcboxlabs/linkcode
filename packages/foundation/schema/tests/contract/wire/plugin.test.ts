import {
  McpPluginDescriptorSchema,
  PluginConfigSetSchema,
  WIRE_PROTOCOL_VERSION,
  WireMessageSchema,
} from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

describe('plugin contracts', () => {
  it('keeps the catalog on its own wire resource', () => {
    const parsed = WireMessageSchema.safeParse({
      v: WIRE_PROTOCOL_VERSION,
      id: 'message-1',
      ts: 0,
      payload: { kind: 'plugin.catalog.get', clientReqId: 'request-1' },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a plugin composed of several servers with per-server services', () => {
    const parsed = McpPluginDescriptorSchema.safeParse({
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
        { type: 'managed', name: 'linkcode-github', service: 'github' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects credential slots that do not match the preset transport', () => {
    const parsed = McpPluginDescriptorSchema.safeParse({
      id: 'github-read',
      labelKey: 'units.githubRead.label',
      descriptionKey: 'units.githubRead.description',
      servers: [
        {
          type: 'preset',
          server: { type: 'http', name: 'github', url: 'http://localhost/mcp' },
          service: 'github',
          credentialSlots: [{ target: 'env', name: 'GITHUB_TOKEN' }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects credential slots on a server without a service key', () => {
    const parsed = McpPluginDescriptorSchema.safeParse({
      id: 'github-read',
      labelKey: 'units.githubRead.label',
      descriptionKey: 'units.githubRead.description',
      servers: [
        {
          type: 'preset',
          server: { type: 'stdio', name: 'github-cli', command: 'github-mcp-server' },
          credentialSlots: [{ target: 'env', name: 'GITHUB_TOKEN' }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('binds connectors per service, never per unit', () => {
    const parsed = PluginConfigSetSchema.safeParse({
      units: [{ unitId: 'github-read', enabled: true }],
      serviceBindings: { github: { type: 'local', connectorId: 'github-personal' } },
    });
    expect(parsed.success).toBe(true);
    const stale = PluginConfigSetSchema.safeParse({
      units: [
        { unitId: 'github-read', enabled: true, binding: { type: 'local', connectorId: 'x' } },
      ],
    });
    expect(stale.success && Object.keys(stale.data.units?.[0] ?? {})).toEqual([
      'unitId',
      'enabled',
    ]);
  });

  it('does not accept a masked credential as an update secret', () => {
    const parsed = PluginConfigSetSchema.safeParse({
      connectorOperations: [
        {
          type: 'update',
          connectorId: 'github-local',
          credential: { type: 'auth-token', configured: true },
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
