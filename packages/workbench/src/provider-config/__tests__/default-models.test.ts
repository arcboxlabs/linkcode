import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { configuredDefaultModels } from '../default-models';

describe('configuredDefaultModels', () => {
  it('uses an active account model before the provider default and ignores stale bindings', () => {
    const providers = {
      codex: {
        enabled: true,
        activeAccountId: 'account-1',
        defaultModel: 'provider-model',
      },
      'claude-code': {
        enabled: true,
        activeAccountId: 'missing-account',
        defaultModel: 'claude-provider-model',
      },
    } satisfies ProvidersConfig;
    const accounts = [
      {
        id: 'account-1',
        label: 'Configured account',
        credential: { type: 'oauth', agent: 'codex' },
        model: 'account-model',
        createdAt: 0,
      },
    ] satisfies Accounts;

    expect(configuredDefaultModels(providers, accounts)).toEqual({
      codex: 'account-model',
      'claude-code': 'claude-provider-model',
    });
  });
});
