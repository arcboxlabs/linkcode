// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const session: {
    data: {
      session: { activeOrganizationId?: string };
      user: { email: string };
    } | null;
    isPending: boolean;
  } = {
    data: {
      session: { activeOrganizationId: 'org_1' },
      user: { email: 'user@example.test' },
    },
    isPending: false,
  };
  return {
    createHostedBillingUrl: vi.fn(() => 'https://console.linkcode.ai/billing'),
    session,
    signIn: vi.fn(),
    summary: {
      data: {
        denomination: 'nano_usd',
        availableAmount: '12500000000',
        reservedAmount: '0',
        displayBalance: { currency: 'USD', amount: '12.50' },
      },
      error: undefined,
    },
  };
});

vi.mock('@linkcode/cloud', () => ({
  createHostedBillingUrl: mocks.createHostedBillingUrl,
}));

vi.mock('@linkcode/ui', () => ({
  BillingSettingsPanel: ({
    balance,
    onSignIn,
    onOpenBilling,
  }: {
    balance: { status: string; amount?: string };
    onSignIn?: () => void;
    onOpenBilling: () => void;
  }) => (
    <div>
      <span>{balance.status}</span>
      {balance.amount ? <span>{balance.amount}</span> : null}
      {onSignIn ? (
        <button type="button" onClick={onSignIn}>
          sign-in
        </button>
      ) : null}
      <button type="button" onClick={onOpenBilling}>
        billing
      </button>
    </div>
  ),
}));

vi.mock('@linkcode/workbench', () => ({
  useCloudBillingSummary: () => mocks.summary,
}));

vi.mock('@webview/cloud/auth', () => ({
  authClient: { useSession: () => mocks.session },
  signInWithCloud: mocks.signIn,
}));

import { BillingSettings } from '../billing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.session.data = {
    session: { activeOrganizationId: 'org_1' },
    user: { email: 'user@example.test' },
  };
  mocks.session.isPending = false;
  mocks.summary.data = {
    denomination: 'nano_usd',
    availableAmount: '12500000000',
    reservedAmount: '0',
    displayBalance: { currency: 'USD', amount: '12.50' },
  };
  mocks.summary.error = undefined;
});

describe('web billing settings', () => {
  it('shows the active organization balance and keeps the hosted handoff', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<BillingSettings />);

    expect(screen.getByText('ready')).toBeTruthy();
    expect(screen.getByText('12.50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'billing' }));

    expect(mocks.createHostedBillingUrl).toHaveBeenCalledWith();
    expect(open).toHaveBeenCalledWith(
      'https://console.linkcode.ai/billing',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('offers sign-in when the Cloud session is signed out', () => {
    mocks.session.data = null;
    render(<BillingSettings />);

    expect(screen.getByText('signed-out')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'sign-in' }));
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });

  it('shows the missing organization state without an active organization', () => {
    mocks.session.data = {
      session: {},
      user: { email: 'user@example.test' },
    };
    render(<BillingSettings />);

    expect(screen.getByText('missing-organization')).toBeTruthy();
  });
});
