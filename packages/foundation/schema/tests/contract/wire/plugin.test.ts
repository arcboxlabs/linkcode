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

  it('rejects credential slots that do not match the preset transport', () => {
    const parsed = McpPluginDescriptorSchema.safeParse({
      id: 'github-read',
      labelKey: 'units.githubRead.label',
      descriptionKey: 'units.githubRead.description',
      service: 'github',
      backing: {
        type: 'preset',
        server: { type: 'http', name: 'github', url: 'http://localhost/mcp' },
        credentialSlots: [{ target: 'env', name: 'GITHUB_TOKEN' }],
      },
    });
    expect(parsed.success).toBe(false);
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
