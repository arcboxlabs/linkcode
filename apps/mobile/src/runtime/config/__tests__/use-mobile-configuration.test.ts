// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { useMobileConfiguration } from '../use-mobile-configuration';

const {
  initializeMobileConfiguration,
  refreshMobileConfiguration,
  registerMobileConfigBackgroundRefresh,
  subscribeToForegroundRefresh,
} = vi.hoisted(() => ({
  initializeMobileConfiguration: vi.fn<() => Promise<void>>(),
  refreshMobileConfiguration: vi.fn(() => Promise.resolve(true)),
  registerMobileConfigBackgroundRefresh: vi.fn(() => Promise.resolve('registered' as const)),
  subscribeToForegroundRefresh: vi.fn(() => vi.fn()),
}));

vi.mock('../mobile', () => ({ initializeMobileConfiguration, refreshMobileConfiguration }));
vi.mock('../background', () => ({ registerMobileConfigBackgroundRefresh }));
vi.mock('../lifecycle', () => ({ subscribeToForegroundRefresh }));
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(), currentState: 'active' },
}));

describe('useMobileConfiguration', () => {
  it('becomes ready from local initialization alone and only then schedules refresh', async () => {
    let finishInitialize = noop;
    initializeMobileConfiguration.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInitialize = resolve;
        }),
    );

    const { result } = renderHook(() => useMobileConfiguration());

    // Startup blocks only on local initialization (bundled defaults + storage) — never on network.
    expect(result.current).toBe(false);
    expect(refreshMobileConfiguration).not.toHaveBeenCalled();

    finishInitialize();
    await waitFor(() => expect(result.current).toBe(true));

    // Remote refresh is fire-and-forget after ready; a slow or offline network cannot delay it.
    expect(refreshMobileConfiguration).toHaveBeenCalledOnce();
    expect(registerMobileConfigBackgroundRefresh).toHaveBeenCalledOnce();
    expect(subscribeToForegroundRefresh).toHaveBeenCalledOnce();
  });
});
