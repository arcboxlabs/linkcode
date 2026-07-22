import { describe, expect, it } from 'vitest';
import { MCP_PLUGIN_CATALOG } from '../plugin/catalog';
import { createSessionHarness } from './fixtures/session-harness';

describe('engine plugin catalog', () => {
  it('declares one valid endpoint-free GitHub unit', () => {
    expect(MCP_PLUGIN_CATALOG).toEqual([
      {
        id: 'github-read',
        labelKey: 'units.githubRead.label',
        descriptionKey: 'units.githubRead.description',
        service: 'github',
        backing: { type: 'managed-connector', name: 'linkcode-github' },
      },
    ]);
    expect(JSON.stringify(MCP_PLUGIN_CATALOG)).not.toContain('token');
    expect(JSON.stringify(MCP_PLUGIN_CATALOG)).not.toContain('url');
  });

  it('serves the catalog without constructing an adapter', async () => {
    const h = createSessionHarness();
    await h.engine.start();
    await h.inject({ kind: 'plugin.catalog.get', clientReqId: 'plugin-catalog-1' });

    expect(h.adapters).toHaveLength(0);
    expect(h.sent).toContainEqual({
      kind: 'plugin.catalog.result',
      replyTo: 'plugin-catalog-1',
      catalog: MCP_PLUGIN_CATALOG,
    });
  });
});
