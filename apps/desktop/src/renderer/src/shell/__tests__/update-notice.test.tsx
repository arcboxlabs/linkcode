// @vitest-environment jsdom

import type { UpdaterState } from '@linkcode/ipc';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { asyncNoop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateNotice } from '../update-notice';

const mocks = vi.hoisted(() => ({
  stateListener: undefined as ((state: UpdaterState) => void) | undefined,
  updaterState: vi.fn(() =>
    Promise.resolve({ status: 'idle', version: null, progress: null } satisfies UpdaterState),
  ),
  installUpdate: vi.fn(),
  unsubscribe: vi.fn(),
  onUpdaterState: vi.fn(),
}));

vi.mock('../../ipc', () => ({
  systemBridge: {
    app: {
      updaterState: mocks.updaterState,
      installUpdate: mocks.installUpdate,
      onUpdaterState: mocks.onUpdaterState,
    },
  },
}));

vi.mock('use-intl', () => ({
  useTranslations() {
    const messages: Record<string, string> = {
      updateReady: 'Update ready',
      updateNow: 'Restart to update',
      changelog: 'Changelog',
    };
    return (key: string) => messages[key] ?? key;
  },
}));

describe('UpdateNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateListener = undefined;
    mocks.onUpdaterState.mockImplementation((listener: (state: UpdaterState) => void) => {
      mocks.stateListener = listener;
      return mocks.unsubscribe;
    });
  });

  afterEach(cleanup);

  it('offers installation and the matching release notes once the download is ready', async () => {
    const { unmount } = render(<UpdateNotice />);
    await act(asyncNoop);
    expect(screen.queryByText('Update ready')).toBeNull();

    act(() => {
      mocks.stateListener?.({ status: 'downloaded', version: '0.13.0', progress: null });
    });

    expect(screen.getByText('v0.13.0')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Changelog' }).getAttribute('href')).toBe(
      'https://github.com/arcboxlabs/linkcode/releases/tag/v0.13.0',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(mocks.installUpdate).toHaveBeenCalledOnce();

    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
