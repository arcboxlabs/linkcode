// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutTab } from '../about-tab';

vi.mock('../../ipc', () => ({
  systemBridge: {
    app: {
      checkForUpdates: vi.fn(),
      version: vi.fn(() => Promise.resolve('0.15.0')),
    },
  },
}));

vi.mock('../../updater', () => ({
  useUpdaterState: () => ({
    status: 'downloading',
    version: '0.16.0',
    progress: 42.4,
  }),
}));

vi.mock('use-intl', () => ({
  useTranslations() {
    const messages: Record<string, string> = {
      version: 'Version',
      checkForUpdates: 'Check for updates',
      'status.downloading': 'Downloading update…',
    };
    return (key: string) => messages[key] ?? key;
  },
}));

describe('AboutTab', () => {
  afterEach(cleanup);

  it('shows accessible update download progress', async () => {
    render(<AboutTab />);

    expect(await screen.findByText('v0.15.0')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: 'Downloading update…' });
    expect(progress.getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText('42%')).toBeTruthy();
  });
});
