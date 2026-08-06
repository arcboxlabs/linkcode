// @vitest-environment jsdom

import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { getProviderConfig } from '@linkcode/sdk';
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

describe('accountModelOptions', () => {
  it('distinguishes a bound agent with nothing picked from one with no account at all', () => {
    const providers = {
      codex: { enabled: true, activeAccountId: 'acc_1' },
      'claude-code': { enabled: true, activeAccountId: 'acc_2' },
      // No account bound: absent, so its pickers fall through and its sends are not blocked.
      opencode: { enabled: true },
    } satisfies ProvidersConfig;
    const accounts = [
      {
        id: 'acc_1',
        label: 'Picked',
        credential: { type: 'api-key', key: 'k' },
        models: [{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }, { id: 'deepseek-v4-flash' }],
        createdAt: 0,
      },
      { id: 'acc_2', label: 'Unpicked', credential: { type: 'api-key', key: 'k' }, createdAt: 0 },
    ] satisfies Accounts;

    expect(accountModelOptions(providers, accounts)).toEqual({
      codex: [
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        // A relay ships bare ids; the id doubles as the label rather than rendering blank.
        { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
      ],
      'claude-code': [],
    });
  });

  it('stays unresolved until both sources have loaded', () => {
    const { result, rerender } = renderHook(() => useAccountModelOptions());

    expect(result.current).toBeNull();

    providersData = {};
    rerender();
    expect(result.current).toBeNull();

    accountsData = [];
    rerender();
    expect(result.current).toEqual({});
  });
});
