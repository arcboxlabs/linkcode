import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  signInSocial: vi.fn(),
  signOut: vi.fn(() => Promise.resolve({ error: null })),
}));

vi.mock('../client', () => ({
  CLOUD_URL: 'https://api.linkcode.ai',
  cloudAuthClient: {
    $fetch: mocks.fetchSession,
    signIn: { social: mocks.signInSocial },
    signOut: mocks.signOut,
  },
}));

vi.mock('@mobile/runtime/notifications', () => ({
  disableDeviceNotifications: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../devices', () => ({ clearDeviceEnrollment: vi.fn() }));

import { reauthenticateToCloud } from '../account';

afterEach(() => {
  vi.clearAllMocks();
});

describe('reauthenticateToCloud', () => {
  it('rejects when the browser resolves without replacing the old session', async () => {
    mocks.signInSocial.mockResolvedValueOnce({ error: null });
    mocks.fetchSession
      .mockResolvedValueOnce({
        data: { session: { id: 'old-session' }, user: { id: 'user-1' } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { session: { id: 'old-session' }, user: { id: 'user-1' } },
        error: null,
      });

    await expect(reauthenticateToCloud()).rejects.toThrow(
      'browser re-authentication did not create a fresh session',
    );
    expect(mocks.fetchSession).toHaveBeenCalledTimes(2);
    expect(mocks.fetchSession).toHaveBeenNthCalledWith(
      2,
      'https://api.linkcode.ai/auth/get-session?disableCookieCache=true',
      {},
    );
  });

  it('accepts a session created by the current browser flow', async () => {
    mocks.signInSocial.mockResolvedValueOnce({ error: null });
    mocks.fetchSession
      .mockResolvedValueOnce({
        data: { session: { id: 'old-session' }, user: { id: 'user-1' } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { session: { id: 'new-session' }, user: { id: 'user-1' } },
        error: null,
      });

    await expect(reauthenticateToCloud()).resolves.toBeUndefined();
  });

  it('rejects when the browser creates a session for another account', async () => {
    mocks.signInSocial.mockResolvedValueOnce({ error: null });
    mocks.fetchSession
      .mockResolvedValueOnce({
        data: { session: { id: 'old-session' }, user: { id: 'user-1' } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { session: { id: 'new-session' }, user: { id: 'user-2' } },
        error: null,
      });

    await expect(reauthenticateToCloud()).rejects.toThrow(
      'browser re-authentication signed in a different account',
    );
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
});
