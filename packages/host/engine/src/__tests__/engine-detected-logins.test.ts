import { CURATED_AGENT_MODELS } from '@linkcode/providers';
import type { AgentRuntimes } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { adoptDetectedLogins } from '../agent/detected-logins';
import { InMemoryProviderConfigStore } from '../agent/provider-config';
import { createTestEngine } from './fixtures/test-engine';

const LOGGED_IN: AgentRuntimes = {
  'claude-code': {
    status: 'available',
    source: 'detected',
    auth: { loggedIn: true, method: 'claude.ai', subscriptionType: 'max', email: 'x@y.z' },
  },
  codex: { status: 'available', source: 'detected', auth: { loggedIn: false } },
};

const ACCOUNT_ID_RE = /^acc_/;

const silentTransport: Transport = {
  connect: () => Promise.resolve(),
  send: noop,
  onMessage: () => noop,
  onClose: () => noop,
  close: noop,
};

describe('detected-login adoption', () => {
  it('adopts a probed CLI login into the pool without binding it', async () => {
    const providerStore = new InMemoryProviderConfigStore();
    const engine = createTestEngine(silentTransport, {
      providerStore,
      agentRuntimesReady: Promise.resolve(LOGGED_IN),
    });
    await engine.start();
    await vi.waitFor(() => expect(providerStore.getAccounts()).toHaveLength(1));

    // Seeded with the curated list, because the pickers offer `Account.models` and nothing else —
    // an account with none is a switch that reveals nothing.
    expect(providerStore.getAccounts()[0]).toEqual({
      id: expect.stringMatching(ACCOUNT_ID_RE),
      label: 'Claude',
      service: 'claude-sub',
      credential: { type: 'oauth', agent: 'claude-code' },
      models: CURATED_AGENT_MODELS['claude-code'],
      createdAt: expect.any(Number),
    });
    // Nothing else grew: no enabled list narrowed, so no session changes what it runs on.
    expect(providerStore.get()).toEqual({});
    await engine.stop();
  });

  it('adopts once, and skips a signed-out runtime', async () => {
    const providerStore = new InMemoryProviderConfigStore();
    await Effect.runPromise(adoptDetectedLogins(providerStore, LOGGED_IN));
    await Effect.runPromise(adoptDetectedLogins(providerStore, LOGGED_IN));
    expect(providerStore.getAccounts()).toHaveLength(1);

    const signedOut = new InMemoryProviderConfigStore();
    await Effect.runPromise(
      adoptDetectedLogins(signedOut, { 'claude-code': { status: 'available' } }),
    );
    expect(signedOut.getAccounts()).toEqual([]);
  });

  it('keeps the accounts a concurrent write added', async () => {
    const providerStore = new InMemoryProviderConfigStore();
    providerStore.update({
      accounts: [
        {
          id: 'acc_key',
          label: 'DeepSeek',
          service: 'deepseek',
          credential: { type: 'api-key', key: 'k' },
          createdAt: 1,
        },
      ],
    });
    await Effect.runPromise(adoptDetectedLogins(providerStore, LOGGED_IN));
    expect(providerStore.getAccounts().map((account) => account.id)).toEqual([
      'acc_key',
      expect.stringMatching(ACCOUNT_ID_RE),
    ]);
  });
});
