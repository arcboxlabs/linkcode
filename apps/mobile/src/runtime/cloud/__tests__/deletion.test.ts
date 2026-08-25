import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAccount: vi.fn(),
  // `vi.hoisted` runs above this file's imports, so `foxts/noop`'s `asyncNoop`
  // isn't in scope here yet — these three are the narrow exception to using it.
  // eslint-disable-next-line sukka/prefer-foxts-noop -- see above
  signOutCloud: vi.fn(() => Promise.resolve()),
  // eslint-disable-next-line sukka/prefer-foxts-noop -- see above
  signInToCloud: vi.fn(() => Promise.resolve()),
  reauthenticateWithApple: vi.fn(),
  // eslint-disable-next-line sukka/prefer-foxts-noop -- see above
  signOutOfIdp: vi.fn(() => Promise.resolve()),
  // eslint-disable-next-line sukka/prefer-foxts-noop -- see above
  clearDeviceEnrollment: vi.fn(() => Promise.resolve()),
  captureException: vi.fn(),
  hosts: [] as Array<{
    id: string;
    name: string;
    createdAt: number;
    tunnelHostId?: string;
    url?: string;
  }>,
  removeHost: vi.fn(),
}));

vi.mock('@sentry/react-native', () => ({ captureException: mocks.captureException }));

vi.mock('../client', () => ({
  CLOUD_URL: 'https://api.linkcode.ai',
  cloudAuthClient: {
    $fetch: mocks.fetchAccount,
    signOut: mocks.signOutCloud,
  },
}));

vi.mock('../account', () => ({
  signInToCloud: mocks.signInToCloud,
}));

vi.mock('../idp', () => ({
  reauthenticateWithApple: mocks.reauthenticateWithApple,
  signOutOfIdp: mocks.signOutOfIdp,
}));

vi.mock('../devices', () => ({
  clearDeviceEnrollment: mocks.clearDeviceEnrollment,
}));

vi.mock('@mobile/stores/host-store', () => ({
  useHostRegistryStore: {
    getState: () => ({ hosts: mocks.hosts, removeHost: mocks.removeHost }),
  },
}));

import { deleteAccount, runAccountDeletionTeardown } from '../deletion';

afterEach(() => {
  vi.clearAllMocks();
  mocks.hosts = [];
});

describe('deleteAccount', () => {
  it('on the Apple branch, forwards the fresh idpToken and authorizationCode', async () => {
    mocks.reauthenticateWithApple.mockResolvedValueOnce({
      idpToken: 'jwt-1',
      authorizationCode: 'apple-code-1',
    });
    mocks.fetchAccount.mockResolvedValueOnce({
      data: { status: 'completed', revocation: 'completed' },
      error: null,
    });

    const result = await deleteAccount({ isAppleAvailable: true });

    expect(result).toEqual({ kind: 'completed', revocation: 'completed' });
    expect(mocks.fetchAccount).toHaveBeenCalledWith(
      'https://api.linkcode.ai/account',
      expect.objectContaining({
        method: 'DELETE',
        body: { idpToken: 'jwt-1', appleAuthorizationCode: 'apple-code-1' },
      }),
    );
  });

  it('on the non-Apple branch, re-runs the browser sign-in and sends the request without an idpToken', async () => {
    mocks.fetchAccount.mockResolvedValueOnce({
      data: { status: 'completed', revocation: 'not_applicable' },
      error: null,
    });

    const result = await deleteAccount({ isAppleAvailable: false });

    expect(result).toEqual({ kind: 'completed', revocation: 'not_applicable' });
    expect(mocks.signInToCloud).toHaveBeenCalledTimes(1);
    expect(mocks.reauthenticateWithApple).not.toHaveBeenCalled();
    expect(mocks.fetchAccount).toHaveBeenCalledWith(
      'https://api.linkcode.ai/account',
      expect.objectContaining({
        body: { idpToken: undefined, appleAuthorizationCode: undefined },
      }),
    );
  });

  it('on the non-Apple branch, a failed browser sign-in is reauthentication-failed, and never sends the delete request', async () => {
    mocks.signInToCloud.mockRejectedValueOnce(new Error('dismissed'));

    const result = await deleteAccount({ isAppleAvailable: false });

    expect(result).toEqual({ kind: 'reauthentication-failed' });
    expect(mocks.fetchAccount).not.toHaveBeenCalled();
  });

  it('reports reauthentication-failed without ever sending the delete request', async () => {
    mocks.reauthenticateWithApple.mockRejectedValueOnce(new Error('cancelled'));

    const result = await deleteAccount({ isAppleAvailable: true });

    expect(result).toEqual({ kind: 'reauthentication-failed' });
    expect(mocks.fetchAccount).not.toHaveBeenCalled();
  });

  it('maps a 401 response to reauthentication-failed', async () => {
    mocks.fetchAccount.mockResolvedValueOnce({ data: null, error: { status: 401 } });

    const result = await deleteAccount({ isAppleAvailable: false });

    expect(result).toEqual({ kind: 'reauthentication-failed' });
  });

  it('maps a 409 pre-check response to failed, carrying the biz code through', async () => {
    mocks.fetchAccount.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: 'ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER' },
    });

    const result = await deleteAccount({ isAppleAvailable: false });

    expect(result).toEqual({
      kind: 'failed',
      code: 'ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER',
    });
  });

  it('treats a pending server response as pending, carrying the reference through', async () => {
    mocks.fetchAccount.mockResolvedValueOnce({
      data: { status: 'pending', reference: 'ref-1' },
      error: null,
    });

    const result = await deleteAccount({ isAppleAvailable: false });

    expect(result).toEqual({ kind: 'pending', reference: 'ref-1' });
  });

  it('treats a thrown network error as pending — never as failed', async () => {
    mocks.fetchAccount.mockRejectedValueOnce(new Error('offline'));

    const result = await deleteAccount({ isAppleAvailable: false });

    expect(result).toEqual({ kind: 'pending' });
  });

  it('treats an unparseable success response as pending rather than completed', async () => {
    mocks.fetchAccount.mockResolvedValueOnce({ data: { unexpected: true }, error: null });

    const result = await deleteAccount({ isAppleAvailable: false });

    expect(result).toEqual({ kind: 'pending' });
  });
});

describe('runAccountDeletionTeardown', () => {
  it('clears the cloud session, the IdP session, and device enrollment', async () => {
    await runAccountDeletionTeardown();

    expect(mocks.signOutCloud).toHaveBeenCalledTimes(1);
    expect(mocks.signOutOfIdp).toHaveBeenCalledTimes(1);
    expect(mocks.clearDeviceEnrollment).toHaveBeenCalledTimes(1);
  });

  it('removes only tunnel-derived hosts, leaving direct/LAN hosts untouched', async () => {
    mocks.hosts = [
      { id: 'host-1', name: 'Tunnel host', createdAt: 1, tunnelHostId: 'device-1' },
      { id: 'host-2', name: 'LAN host', createdAt: 2, url: 'http://192.168.1.5:9000' },
    ];

    await runAccountDeletionTeardown();

    expect(mocks.removeHost).toHaveBeenCalledExactlyOnceWith('host-1');
  });

  it('reports one step failing without throwing, so the others still run', async () => {
    mocks.signOutCloud.mockRejectedValueOnce(new Error('network down'));

    await expect(runAccountDeletionTeardown()).resolves.toBeUndefined();

    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.signOutOfIdp).toHaveBeenCalledTimes(1);
    expect(mocks.clearDeviceEnrollment).toHaveBeenCalledTimes(1);
  });

  it('is safe to call again on an already-clean state', async () => {
    await runAccountDeletionTeardown();
    await expect(runAccountDeletionTeardown()).resolves.toBeUndefined();
  });
});
