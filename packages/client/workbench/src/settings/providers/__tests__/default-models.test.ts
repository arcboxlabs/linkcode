// @vitest-environment jsdom

import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { getProviderConfig } from '@linkcode/sdk';
import { modelChoiceKey } from '@linkcode/ui';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountModelOptions,
  configuredDefaultModels,
  useAccountModelOptions,
  useConfiguredDefaultModels,
} from '../default-models';

const { useDataMock } = vi.hoisted(() => ({ useDataMock: vi.fn() }));

vi.mock('../../../runtime/tayori', () => ({ useData: useDataMock }));

let providersData: ProvidersConfig | undefined;
let accountsData: Accounts | undefined;

beforeEach(() => {
  providersData = undefined;
  accountsData = undefined;
  useDataMock.mockImplementation((operation: unknown) => ({
    data: operation === getProviderConfig ? providersData : accountsData,
  }));
});

afterEach(() => {
  cleanup();
  useDataMock.mockReset();
});

describe('configuredDefaultModels', () => {
  it('reads the per-agent pick and reports nothing for an agent that has none', () => {
    const providers = {
      codex: { enabled: true, activeAccountId: 'account-1', model: 'gpt-5.6-sol' },
      // Bound but unpicked: no model to report, so a session start refuses rather than guessing.
      'claude-code': { enabled: true, activeAccountId: 'account-1' },
    } satisfies ProvidersConfig;

    expect(configuredDefaultModels(providers)).toEqual({ codex: 'gpt-5.6-sol' });
  });

  it('keeps the pick unresolved until the provider config has loaded', () => {
    const { result, rerender } = renderHook(() => useConfiguredDefaultModels());

    expect(result.current).toBeNull();

    providersData = {};
    rerender();
    expect(result.current).toEqual({});
  });
});

const anthropicAccount = {
  id: 'acc_anthropic',
  label: 'Anthropic',
  service: 'anthropic-api',
  credential: { type: 'api-key', key: 'k' },
  models: [{ id: 'claude-opus-5', label: 'Opus 5' }],
  createdAt: 0,
} satisfies Accounts[number];

const deepseekAccount = {
  id: 'acc_deepseek',
  label: 'DeepSeek',
  service: 'deepseek',
  credential: { type: 'api-key', key: 'k' },
  models: [{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }, { id: 'deepseek-v4-flash' }],
  createdAt: 0,
} satisfies Accounts[number];

describe('accountModelOptions', () => {
  it('spans every account that can back the agent, tagged with the account it came from', () => {
    const options = accountModelOptions([anthropicAccount, deepseekAccount]);

    // claude-code speaks both: Anthropic natively, DeepSeek through its Anthropic-shaped endpoint.
    expect(options['claude-code']).toEqual([
      {
        id: 'claude-opus-5',
        label: 'Opus 5',
        description: 'Anthropic',
        accountId: 'acc_anthropic',
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: 'DeepSeek',
        accountId: 'acc_deepseek',
      },
      {
        id: 'deepseek-v4-flash',
        // A relay ships bare ids; the id doubles as the label rather than rendering blank.
        label: 'deepseek-v4-flash',
        description: 'DeepSeek',
        accountId: 'acc_deepseek',
      },
    ]);
  });

  it('omits an agent no account can back, and keeps a bindable-but-unpicked one empty', () => {
    // grok-build only accepts an xAI account, so neither of these can back it.
    expect(accountModelOptions([anthropicAccount, deepseekAccount])['grok-build']).toBeUndefined();
    // Bindable with nothing ticked: present-and-empty, which is what blocks sending.
    expect(
      accountModelOptions([{ ...anthropicAccount, models: undefined }])['claude-code'],
    ).toEqual([]);
  });

  it('keeps same-id models from two accounts as separate, identifiable entries', () => {
    const shared = { ...anthropicAccount, id: 'acc_other', label: 'Work key' };
    const options = accountModelOptions([anthropicAccount, shared])['claude-code'] ?? [];

    expect(options).toHaveLength(2);
    expect(new Set(options.map(modelChoiceKey)).size).toBe(2);
  });

  it('stays unresolved until the account pool has loaded', () => {
    const { result, rerender } = renderHook(() => useAccountModelOptions());

    expect(result.current).toBeNull();

    accountsData = [];
    rerender();
    expect(result.current).toEqual({});
  });
});
