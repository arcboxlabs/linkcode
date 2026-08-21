// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingSettingsPanel } from '../billing-settings-panel';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

describe('BillingSettingsPanel', () => {
  it('shows the balance and keeps the hosted billing handoff', () => {
    const onOpenBilling = vi.fn();
    render(
      <BillingSettingsPanel
        balance={{ status: 'ready', amount: '12.50', currency: 'USD' }}
        onOpenBilling={onOpenBilling}
      />,
    );

    expect(screen.getByText('description')).toBeTruthy();
    expect(screen.getByText('hostedHint')).toBeTruthy();
    expect(screen.getByText('12.50')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'openOnWeb' }));
    expect(onOpenBilling).toHaveBeenCalledOnce();
  });

  it('offers Cloud sign-in when signed out', () => {
    const onSignIn = vi.fn();
    render(
      <BillingSettingsPanel
        balance={{ status: 'signed-out' }}
        onSignIn={onSignIn}
        onOpenBilling={vi.fn()}
      />,
    );

    expect(screen.getByText('signedOut')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'signIn' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing-organization', 'missingOrganization'],
    ['error', 'loadError'],
  ] as const)('renders the %s state', (status, message) => {
    render(<BillingSettingsPanel balance={{ status }} onOpenBilling={vi.fn()} />);

    expect(screen.getByText(message)).toBeTruthy();
  });
});
