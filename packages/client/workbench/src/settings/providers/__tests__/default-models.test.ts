// @vitest-environment jsdom

import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { getProviderConfig } from '@linkcode/sdk';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredDefaultModels, useConfiguredDefaultModels } from '../default-models';

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

  it('keeps defaults unresolved until both configuration sources have loaded', () => {
    const { result, rerender } = renderHook(() => useConfiguredDefaultModels());

    expect(result.current).toBeNull();

    providersData = {};
    rerender();
    expect(result.current).toBeNull();

    accountsData = [];
    rerender();
    expect(result.current).toEqual({});
  });
});
