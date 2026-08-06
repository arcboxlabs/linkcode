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
