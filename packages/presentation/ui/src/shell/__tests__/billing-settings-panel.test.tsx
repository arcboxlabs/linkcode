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
  it('offers only the hosted billing handoff', () => {
    const onOpenBilling = vi.fn();
    render(<BillingSettingsPanel onOpenBilling={onOpenBilling} />);

    expect(screen.getByText('description')).toBeTruthy();
    expect(screen.getByText('hostedHint')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'openOnWeb' }));
    expect(onOpenBilling).toHaveBeenCalledOnce();
  });
});
