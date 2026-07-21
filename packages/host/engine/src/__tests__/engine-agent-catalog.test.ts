import type { AgentStartCatalogOptions } from '@linkcode/agent-adapter';
import type { Account, AgentStartCatalog } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { InMemoryProviderConfigStore } from '../agent/provider-config';
import { createSessionHarness, FakeAdapter } from './fixtures/session-harness';

class CatalogAdapter extends FakeAdapter {
  catalogOptions: AgentStartCatalogOptions | undefined;

  override startCatalog(opts?: AgentStartCatalogOptions): Promise<AgentStartCatalog> {
    this.catalogOptions = opts;
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
  it('loads a catalog with the requested cwd and daemon-resolved account config', async () => {
    const adapter = new CatalogAdapter();
    const providers = new InMemoryProviderConfigStore();
    const account: Account = {
      id: 'catalog-account',
      label: 'Catalog account',
      credential: { type: 'api-key', key: 'catalog-key' },
      endpoint: { baseUrl: 'https://catalog.example.test', protocol: 'openai-chat' },
      model: 'provider/model',
      createdAt: 0,
    };
    providers.set({
      'claude-code': { enabled: true, activeAccountId: account.id },
    });
    providers.setAccounts([account]);
    const h = createSessionHarness(
      undefined,
      () => adapter,
      undefined,
      undefined,
      undefined,
      providers,
    );
    await h.engine.start();
    await h.inject({
      kind: 'agent.catalog',
      clientReqId: 'catalog-1',
      agentKind: 'claude-code',
      cwd: '/repo',
    });

    expect(h.adapters).toHaveLength(1);
    expect(adapter.catalogOptions).toEqual({
      cwd: '/repo',
      model: 'provider/model',
      config: {
        apiKey: 'catalog-key',
        baseUrl: 'https://catalog.example.test',
        protocol: 'openai-chat',
      },
    });
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
