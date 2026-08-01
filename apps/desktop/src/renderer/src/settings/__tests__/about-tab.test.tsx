// @vitest-environment jsdom

import type { UpdaterState } from '@linkcode/ipc';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutTab } from '../about-tab';

const mocks = vi.hoisted(() => ({
  useUpdaterState: vi.fn(),
  checkForUpdates: vi.fn(),
  installUpdate: vi.fn(),
}));

vi.mock('../../ipc', () => ({
  systemBridge: {
    app: {
      checkForUpdates: mocks.checkForUpdates,
      installUpdate: mocks.installUpdate,
      version: vi.fn(() => Promise.resolve('0.15.0')),
    },
  },
}));

vi.mock('../../updater', () => ({
  useUpdaterState: mocks.useUpdaterState,
}));

vi.mock('use-intl', () => ({
  useTranslations() {
    const messages: Record<string, string> = {
      version: 'Version',
      checkForUpdates: 'Check for updates',
      restartToInstall: 'Restart to update',
      'status.downloading': 'Downloading update…',
      'status.downloaded': 'Update ready — restart to install.',
    };
    return (key: string) => messages[key] ?? key;
  },
}));

describe('AboutTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useUpdaterState.mockReturnValue({
      status: 'downloading',
      version: '0.16.0',
      progress: 42.4,
    } satisfies UpdaterState);
  });

  afterEach(cleanup);

  it('shows accessible update download progress', async () => {
    render(<AboutTab />);

    expect(await screen.findByText('v0.15.0')).toBeTruthy();
    const progress = screen.getByRole('progressbar', { name: 'Downloading update…' });
    expect(progress.getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText('42%')).toBeTruthy();
  });

  // Main refuses a re-check while an update sits downloaded, so the check button must not be offered.
  it('offers the install instead of a check once the update is downloaded', () => {
    mocks.useUpdaterState.mockReturnValue({
      status: 'downloaded',
      version: '0.16.0',
      progress: null,
    } satisfies UpdaterState);
    render(<AboutTab />);

    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(mocks.installUpdate).toHaveBeenCalledOnce();
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
  });
});
