import type { Account } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { CustomDraft } from '../account-form';
import { customAccount, customDraftFromAccount } from '../account-form';

const DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function draft(overrides: Partial<CustomDraft>): CustomDraft {
  return {
    label: 'Gateway',
    type: 'api-key',
    secret: 'sk-test',
    baseUrl: '',
    protocol: '',
    model: '',
    providerName: '',
    models: [],
    ...overrides,
  };
}

const imported: Account = {
  id: 'acc_imported',
  label: 'banned',
  credential: { type: 'api-key', key: 'sk-old' },
  endpoint: { baseUrl: 'https://gw.example.com/v1', protocol: 'openai-chat' },
  customProvider: {
    name: 'banned',
    models: [
      {
        id: '@cf/deepseek-r1',
        name: 'DeepSeek R1',
        reasoning: true,
        input: ['text', 'image'],
        cost: { input: 0.5, output: 4.88, cacheRead: 0.1, cacheWrite: 0.2 },
        contextWindow: 80000,
        maxTokens: 8192,
        thinkingLevelMap: { low: 'off', high: null },
      },
    ],
  },
  extraEnv: { GATEWAY_FLAG: '1' },
  service: 'openrouter',
  createdAt: 1234,
};

describe('customAccount (create)', () => {
  it('builds a fresh account and omits endpoint without baseUrl+protocol', () => {
    const account = customAccount(draft({ label: '  Pad  ' }));
    expect(account.id).toMatch(/^acc_/);
    expect(account.label).toBe('Pad');
    expect(account.endpoint).toBeUndefined();
    expect(account.customProvider).toBeUndefined();
    expect(account.service).toBeUndefined();
  });

  it('gives new model rows the form defaults', () => {
    const account = customAccount(
      draft({
        baseUrl: 'https://gw.example.com/v1',
        protocol: 'openai-chat',
        providerName: 'gw',
        models: [{ id: 'm1', name: '', reasoning: false, contextWindow: 131072, maxTokens: 8192 }],
      }),
    );
    expect(account.customProvider?.models[0]).toEqual({
      id: 'm1',
      reasoning: false,
      input: ['text'],
      cost: DEFAULT_COST,
      contextWindow: 131072,
      maxTokens: 8192,
    });
  });
});

describe('customAccount (edit)', () => {
  it('preserves id, createdAt, service, and extraEnv', () => {
    const account = customAccount(customDraftFromAccount(imported), imported);
    expect(account.id).toBe('acc_imported');
    expect(account.createdAt).toBe(1234);
    expect(account.service).toBe('openrouter');
    expect(account.extraEnv).toEqual({ GATEWAY_FLAG: '1' });
  });

  it('keeps cost, input, and thinkingLevelMap for model rows retained by id', () => {
    const edited = customDraftFromAccount(imported);
    edited.models[0].maxTokens = 16384;
    const account = customAccount(edited, imported);
    expect(account.customProvider?.models[0]).toEqual({
      ...imported.customProvider!.models[0],
      maxTokens: 16384,
    });
  });

  it('treats a renamed model id as a new row with defaults', () => {
    const edited = customDraftFromAccount(imported);
    edited.models[0].id = '@cf/other';
    const account = customAccount(edited, imported);
    const model = account.customProvider?.models[0];
    expect(model?.cost).toEqual(DEFAULT_COST);
    expect(model?.input).toEqual(['text']);
    expect(model?.thinkingLevelMap).toBeUndefined();
  });

  it('roundtrips an unchanged draft back to the same account', () => {
    expect(customAccount(customDraftFromAccount(imported), imported)).toEqual(imported);
  });
});
