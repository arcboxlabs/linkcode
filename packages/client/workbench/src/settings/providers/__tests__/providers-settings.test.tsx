// @vitest-environment jsdom

import type { Accounts } from '@linkcode/schema';
import { getAccounts, getProviderConfig, setAccounts, setProviderConfig } from '@linkcode/sdk';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvidersSettingsPanel } from '../providers-settings';

const mocks = vi.hoisted(() => ({
  mutateAccounts: vi.fn(),
  mutateProviders: vi.fn(),
  saveAccounts: vi.fn(),
  saveProviders: vi.fn(),
  toastAdd: vi.fn(),
  translate: vi.fn((key: string) => key),
  useData: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock('../../../runtime/tayori', () => ({
  useData: mocks.useData,
  useMutation: mocks.useMutation,
}));

vi.mock('../../../agent-runtime/hooks', () => ({
  useAgentRuntimes: () => ({ data: undefined }),
}));

vi.mock('../../../agent-runtime/onboarding', () => ({
  useAgentRuntimeOnboarding: () => ({ cancelLogin: vi.fn() }),
}));

vi.mock('../add-flow', () => ({
  AddAccountForm: () => null,
  EditAccountForm: () => null,
  ServiceCatalogView: () => null,
}));

vi.mock('../model-selection', () => ({
  useModelSources: () => ({}),
}));

vi.mock('@linkcode/ui', () => ({
  AccountDetail: () => null,
  AccountList({
    accounts,
    onReorder,
  }: {
    accounts: Array<{ id: string; label: string }>;
    onReorder?: (orderedIds: string[]) => void;
  }) {
    return (
      <>
        <output data-testid="account-order">{accounts.map(({ label }) => label).join(',')}</output>
        <button
          type="button"
          onClick={() => onReorder?.([...accounts].reverse().map(({ id }) => id))}
        >
          reorder
        </button>
      </>
    );
  },
}));

vi.mock('coss-ui/components/toast', () => ({
  toastManager: { add: mocks.toastAdd },
}));

vi.mock('use-intl', () => ({
  useTranslations() {
    return mocks.translate;
  },
}));

const INITIAL_ACCOUNTS = [
  {
    id: 'account-a',
    label: 'Account A',
    service: 'anthropic-api',
    credential: { type: 'api-key', key: 'anthropic-key' },
    models: [{ id: 'claude-opus-5' }],
    createdAt: 1,
  },
  {
    id: 'account-b',
    label: 'Account B',
    service: 'deepseek',
    credential: { type: 'api-key', key: 'deepseek-key' },
    models: [{ id: 'deepseek-v4-pro' }],
    createdAt: 2,
  },
] satisfies Accounts;

let accountData: Accounts;
let daemonAccounts: Accounts;

beforeEach(() => {
  accountData = [...INITIAL_ACCOUNTS];
  daemonAccounts = [...INITIAL_ACCOUNTS];

  mocks.mutateAccounts.mockImplementation((next?: Accounts) => {
    accountData = next ?? daemonAccounts;
    return Promise.resolve(accountData);
  });
  mocks.saveAccounts.mockImplementation(({ accounts }: { accounts: Accounts }) => {
    daemonAccounts = accounts;
    return Promise.resolve();
  });
  mocks.useData.mockImplementation((operation: unknown) => {
    if (operation === getAccounts) {
      return { data: accountData, isLoading: false, mutate: mocks.mutateAccounts };
    }
    if (operation === getProviderConfig) {
      return { data: {}, mutate: mocks.mutateProviders };
    }
    throw new Error('Unexpected data operation');
  });
  mocks.useMutation.mockImplementation((operation: unknown) => {
    if (operation === setAccounts) {
      return { trigger: mocks.saveAccounts, isMutating: false };
    }
    if (operation === setProviderConfig) {
      return { trigger: mocks.saveProviders, isMutating: false };
    }
    throw new Error('Unexpected mutation operation');
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('provider account ordering', () => {
  it('persists the emitted order and reconciles it from daemon state', async () => {
    const { rerender } = render(<ProvidersSettingsPanel />);
    expect(screen.getByTestId('account-order').textContent).toBe('Account A,Account B');

    fireEvent.click(screen.getByRole('button', { name: 'reorder' }));

    await waitFor(() => expect(mocks.saveAccounts).toHaveBeenCalledTimes(1));
    expect(
      mocks.saveAccounts.mock.calls[0]?.[0].accounts.map(({ id }: Accounts[number]) => id),
    ).toEqual(['account-b', 'account-a']);
    await waitFor(() => expect(mocks.mutateAccounts).toHaveBeenCalledTimes(2));
    expect(mocks.mutateAccounts.mock.calls[0]?.[0].map(({ id }: Accounts[number]) => id)).toEqual([
      'account-b',
      'account-a',
    ]);
    expect(mocks.mutateAccounts.mock.calls[1]).toEqual([]);

    rerender(<ProvidersSettingsPanel />);
    expect(screen.getByTestId('account-order').textContent).toBe('Account B,Account A');
  });

  it('restores the previous order and reports a rejected save', async () => {
    mocks.saveAccounts.mockRejectedValueOnce(new Error('disk full'));
    const { rerender } = render(<ProvidersSettingsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'reorder' }));

    await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledTimes(1));
    expect(mocks.mutateAccounts).toHaveBeenCalledTimes(2);
    expect(mocks.mutateAccounts.mock.calls[1]?.[0].map(({ id }: Accounts[number]) => id)).toEqual([
      'account-a',
      'account-b',
    ]);
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: 'error',
      title: 'reorderFailed',
      description: 'disk full',
    });

    rerender(<ProvidersSettingsPanel />);
    expect(screen.getByTestId('account-order').textContent).toBe('Account A,Account B');
  });
});

describe('restricted-brand allowlists (CODE-618)', () => {
  it('still lists a stored account whose service the current build excludes from the catalog', () => {
    // Neither account's service ('anthropic-api', 'deepseek') is in this allowlist — the account
    // list/detail must stay unfiltered regardless; only the add-account catalog narrows.
    render(<ProvidersSettingsPanel allowedServices={['linkcode-gateway']} />);
    expect(screen.getByTestId('account-order').textContent).toBe('Account A,Account B');
  });
});
