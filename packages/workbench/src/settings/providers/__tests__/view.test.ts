import type { ProvidersConfig } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  accountConfigSnippet,
  boundAgentKinds,
  maskSecret,
  withBinding,
  withModel,
  withoutAccount,
} from '../view';

const providers: ProvidersConfig = {
  'claude-code': { enabled: true, activeAccountId: 'acc_a', defaultModel: 'claude-opus-4-8' },
  codex: { enabled: false, activeAccountId: 'acc_b' },
  opencode: { enabled: true },
};

describe('binding transforms', () => {
  it('binds while preserving the entry and defaults enabled for a fresh kind', () => {
    const next = withBinding(providers, 'codex', 'acc_a');
    expect(next.codex).toEqual({ enabled: false, activeAccountId: 'acc_a' });
    expect(withBinding(providers, 'pi', 'acc_a').pi).toEqual({
      enabled: true,
      activeAccountId: 'acc_a',
    });
  });

  it('unbinds by dropping only activeAccountId', () => {
    const next = withBinding(providers, 'claude-code', undefined);
    expect(next['claude-code']).toEqual({ enabled: true, defaultModel: 'claude-opus-4-8' });
  });

  it('sets and clears the default model without touching the binding', () => {
    expect(withModel(providers, 'claude-code', 'claude-sonnet-5')['claude-code']).toEqual({
      enabled: true,
      activeAccountId: 'acc_a',
      defaultModel: 'claude-sonnet-5',
    });
    expect(withModel(providers, 'claude-code', undefined)['claude-code']).toEqual({
      enabled: true,
      activeAccountId: 'acc_a',
    });
  });

  it('clears every binding of a removed account, identity-stable when none matched', () => {
    const next = withoutAccount(providers, 'acc_a');
    expect(next['claude-code']).toEqual({ enabled: true, defaultModel: 'claude-opus-4-8' });
    expect(next.codex).toEqual({ enabled: false, activeAccountId: 'acc_b' });
    expect(withoutAccount(providers, 'acc_missing')).toBe(providers);
  });
});

describe('view helpers', () => {
  it('lists bound agents in stable order and renders the config snippet from them', () => {
    expect(boundAgentKinds(providers, 'acc_a')).toEqual(['claude-code']);
    const snippet = accountConfigSnippet(providers, 'acc_a');
    expect(JSON.parse(snippet)).toEqual({
      providers: {
        'claude-code': { enabled: true, activeAccountId: 'acc_a', defaultModel: 'claude-opus-4-8' },
      },
    });
  });

  it('masks short secrets entirely and long ones tail-anchored', () => {
    expect(maskSecret('short')).toBe('••••••••');
    expect(maskSecret('sk-or-v1-9f2c7ae841b0d63f5e2a')).toBe('sk-or-…5e2a');
  });
});
