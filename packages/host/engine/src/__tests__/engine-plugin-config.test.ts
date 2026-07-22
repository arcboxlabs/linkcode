import { describe, expect, it } from 'vitest';
import { InMemoryProviderConfigStore } from '../agent/provider-config';
import { createSessionHarness } from './fixtures/session-harness';

describe('engine plugin config', () => {
  it('masks local credentials on config.get', async () => {
    const store = new InMemoryProviderConfigStore();
    store.setPlugins({
      units: [],
      connectors: [
        {
          id: 'github-personal',
          service: 'github',
          credential: { type: 'auth-token', secret: 'private-github-token' },
        },
      ],
    });
    const h = createSessionHarness(undefined, undefined, undefined, undefined, undefined, store);
    await h.engine.start();

    await h.inject({ kind: 'config.get', clientReqId: 'plugin-config-get' });

    expect(h.sent).toContainEqual({
      kind: 'config.get.result',
      replyTo: 'plugin-config-get',
      providers: {},
      accounts: [],
      plugins: {
        units: [],
        connectors: [
          {
            id: 'github-personal',
            service: 'github',
            credential: { type: 'auth-token', configured: true },
          },
        ],
      },
    });
    expect(JSON.stringify(h.sent)).not.toContain('private-github-token');
  });

  it('updates plugins without changing provider or account state', async () => {
    const store = new InMemoryProviderConfigStore();
    store.set({ codex: { enabled: true } });
    store.setAccounts([
      {
        id: 'codex-key',
        label: 'Codex',
        credential: { type: 'api-key', key: 'provider-secret' },
        createdAt: 0,
      },
    ]);
    const h = createSessionHarness(undefined, undefined, undefined, undefined, undefined, store);
    await h.engine.start();

    await h.inject({
      kind: 'config.set',
      clientReqId: 'plugin-config-set',
      plugins: {
        connectorOperations: [
          {
            type: 'create',
            connector: {
              id: 'github-personal',
              service: 'github',
              credential: { type: 'auth-token', secret: 'github-secret' },
            },
          },
        ],
      },
    });

    expect(store.get()).toEqual({ codex: { enabled: true } });
    expect(store.getAccounts()).toHaveLength(1);
    expect(store.getPlugins().connectors[0]?.credential.secret).toBe('github-secret');
    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'plugin-config-set' });
  });

  it('emits a typed warning when an enabled managed unit cannot be resolved', async () => {
    const store = new InMemoryProviderConfigStore();
    store.setPlugins({
      units: [{ unitId: 'github-read', enabled: true, binding: { type: 'managed' } }],
      connectors: [],
    });
    const h = createSessionHarness(undefined, undefined, undefined, undefined, undefined, store);
    await h.engine.start();

    await h.inject({
      kind: 'session.start',
      clientReqId: 'plugin-session-start',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });

    const started = h.sent.find(
      (payload) => payload.kind === 'session.started' && payload.replyTo === 'plugin-session-start',
    );
    expect(started?.kind).toBe('session.started');
    expect(h.sent).toContainEqual({
      kind: 'agent.event',
      sessionId: started?.kind === 'session.started' ? started.sessionId : '',
      event: { type: 'plugin-warning', unitId: 'github-read', reason: 'broker-unavailable' },
    });
    expect(JSON.stringify(await h.store.load())).not.toContain('credential');
  });
});
