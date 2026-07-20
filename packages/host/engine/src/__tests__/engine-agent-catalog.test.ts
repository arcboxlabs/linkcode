import type { AgentStartCatalog } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createSessionHarness, FakeAdapter } from './fixtures/session-harness';

class CatalogAdapter extends FakeAdapter {
  catalogCwd: string | undefined;

  override startCatalog(opts?: { cwd?: string }): Promise<AgentStartCatalog> {
    this.catalogCwd = opts?.cwd;
    return Promise.resolve({
      models: [{ id: 'pi/sonnet', label: 'Sonnet', effortLevels: ['low', 'high'] }],
      policies: [{ policyId: 'default', name: 'Default' }],
      defaultPolicyId: 'default',
    });
  }
}

class RejectingCatalogAdapter extends FakeAdapter {
  override startCatalog(): Promise<AgentStartCatalog> {
    return Promise.reject(new Error('private provider credential detail'));
  }
}

describe('engine agent catalog', () => {
  it('loads a catalog from a fresh adapter with the requested cwd', async () => {
    const adapter = new CatalogAdapter();
    const h = createSessionHarness(undefined, () => adapter);
    await h.engine.start();
    await h.inject({
      kind: 'agent.catalog',
      clientReqId: 'catalog-1',
      agentKind: 'claude-code',
      cwd: '/repo',
    });

    expect(h.adapters).toHaveLength(1);
    expect(adapter.catalogCwd).toBe('/repo');
    expect(h.sent).toContainEqual({
      kind: 'agent.cataloged',
      replyTo: 'catalog-1',
      catalog: {
        models: [{ id: 'pi/sonnet', label: 'Sonnet', effortLevels: ['low', 'high'] }],
        policies: [{ policyId: 'default', name: 'Default' }],
        defaultPolicyId: 'default',
      },
    });
  });

  it('sanitizes a catalog failure', async () => {
    const h = createSessionHarness(undefined, () => new RejectingCatalogAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'agent.catalog',
      clientReqId: 'catalog-2',
      agentKind: 'claude-code',
      cwd: '/repo',
    });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'catalog-2',
      code: 'operation_failed',
      message: 'Failed to load agent catalog',
    });
    expect(JSON.stringify(h.sent)).not.toContain('private provider credential detail');
  });
});
