// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createHostedBillingUrl: vi.fn(() => 'https://console.linkcode.ai/billing'),
}));

vi.mock('@linkcode/cloud', () => ({
  createHostedBillingUrl: mocks.createHostedBillingUrl,
}));

vi.mock('@linkcode/ui', () => ({
  BillingSettingsPanel: ({ onOpenBilling }: { onOpenBilling: () => void }) => (
    <button type="button" onClick={onOpenBilling}>
      billing
    </button>
  ),
}));

import { BillingSettings } from '../billing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('web hosted billing handoff', () => {
  it('opens the SDK URL without a desktop return target', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<BillingSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'billing' }));

    expect(mocks.createHostedBillingUrl).toHaveBeenCalledWith();
    expect(open).toHaveBeenCalledWith(
      'https://console.linkcode.ai/billing',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
