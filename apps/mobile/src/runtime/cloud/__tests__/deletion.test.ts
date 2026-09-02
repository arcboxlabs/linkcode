import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class CloudAccountMismatchError extends Error {
    override name = 'CloudAccountMismatchError';
  }
  class IdpTokenAcquisitionError extends Error {
    override name = 'IdpTokenAcquisitionError';
  }
  return {
    fetchDelete: vi.fn(),
    fetchRequirements: vi.fn(),
    // `vi.hoisted` runs above this file's imports, so `foxts/noop`'s `asyncNoop`
    // isn't in scope here yet — these three are the narrow exception to using it.
    // eslint-disable-next-line sukka/prefer-foxts-noop -- see above
    signOutCloud: vi.fn(() => Promise.resolve()),
    // eslint-disable-next-line sukka/prefer-foxts-noop -- see above
    reauthenticateToCloud: vi.fn(() => Promise.resolve()),
    reauthenticateWithApple: vi.fn(),
    isAppleAuthenticationAvailable: vi.fn(() => Promise.resolve(true)),
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
    CloudAccountMismatchError,
    IdpTokenAcquisitionError,
  };
});

vi.mock('@sentry/react-native', () => ({ captureException: mocks.captureException }));

vi.mock('../client', () => ({
  CLOUD_URL: 'https://api.linkcode.ai',
  cloudAuthClient: {
    $fetch: (url: string, options: unknown) =>
      url.endsWith('/deletion-requirements')
        ? mocks.fetchRequirements(url, options)
        : mocks.fetchDelete(url, options),
    signOut: mocks.signOutCloud,
  },
}));

vi.mock('../account', () => ({
  CloudAccountMismatchError: mocks.CloudAccountMismatchError,
  reauthenticateToCloud: mocks.reauthenticateToCloud,
}));

vi.mock('../idp', () => ({
  IdpTokenAcquisitionError: mocks.IdpTokenAcquisitionError,
  isAppleAuthenticationAvailable: mocks.isAppleAuthenticationAvailable,
  isAppleSignInCancel: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_REQUEST_CANCELED',
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

beforeEach(() => {
  mocks.fetchRequirements.mockResolvedValue({ data: { method: 'browser' }, error: null });
  mocks.isAppleAuthenticationAvailable.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  mocks.hosts = [];
});

describe('deleteAccount', () => {
  it('does not re-authenticate or delete when requirements cannot be read', async () => {
    mocks.fetchRequirements.mockResolvedValueOnce({ data: null, error: { status: 503 } });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'failed' });
    expect(mocks.reauthenticateWithApple).not.toHaveBeenCalled();
    expect(mocks.reauthenticateToCloud).not.toHaveBeenCalled();
    expect(mocks.fetchDelete).not.toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { account_deletion_stage: 'requirements' } }),
    );
  });

  it('on the Apple branch, forwards the fresh idpToken and authorizationCode', async () => {
    mocks.fetchRequirements.mockResolvedValueOnce({ data: { method: 'native' }, error: null });
    mocks.reauthenticateWithApple.mockResolvedValueOnce({
      idpToken: 'jwt-1',
      authorizationCode: 'apple-code-1',
    });
    mocks.fetchDelete.mockResolvedValueOnce({
      data: { status: 'completed', authorizationRevocation: 'completed' },
      error: null,
    });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'completed', authorizationRevocation: 'completed' });
    expect(mocks.fetchDelete).toHaveBeenCalledWith(
      'https://api.linkcode.ai/account',
      expect.objectContaining({
        method: 'DELETE',
        body: { idpToken: 'jwt-1', appleAuthorizationCode: 'apple-code-1' },
      }),
    );
  });

  it('does not report or delete when native re-authentication is unavailable', async () => {
    mocks.fetchRequirements.mockResolvedValueOnce({ data: { method: 'native' }, error: null });
    mocks.isAppleAuthenticationAvailable.mockResolvedValueOnce(false);

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'apple-device-required' });
    expect(mocks.reauthenticateWithApple).not.toHaveBeenCalled();
    expect(mocks.fetchDelete).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('on the non-Apple branch, re-runs the browser sign-in and sends the request without an idpToken', async () => {
    mocks.fetchDelete.mockResolvedValueOnce({
      data: { status: 'completed', authorizationRevocation: 'not_applicable' },
      error: null,
    });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'completed', authorizationRevocation: 'not_applicable' });
    expect(mocks.reauthenticateToCloud).toHaveBeenCalledTimes(1);
    expect(mocks.reauthenticateWithApple).not.toHaveBeenCalled();
    expect(mocks.fetchDelete).toHaveBeenCalledWith(
      'https://api.linkcode.ai/account',
      expect.objectContaining({
        body: { idpToken: undefined, appleAuthorizationCode: undefined },
      }),
    );
  });

  it('on the non-Apple branch, a failed browser sign-in is reauthentication-failed, and never sends the delete request', async () => {
    mocks.reauthenticateToCloud.mockRejectedValueOnce(new Error('dismissed'));

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'reauthentication-failed' });
    expect(mocks.fetchDelete).not.toHaveBeenCalled();
  });

  it('does not report or delete after browser re-authentication switches accounts', async () => {
    mocks.reauthenticateToCloud.mockRejectedValueOnce(
      new mocks.CloudAccountMismatchError('different account'),
    );

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'account-mismatch' });
    expect(mocks.fetchDelete).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('reports reauthentication-failed without ever sending the delete request', async () => {
    mocks.fetchRequirements.mockResolvedValueOnce({ data: { method: 'native' }, error: null });
    mocks.reauthenticateWithApple.mockRejectedValueOnce(new Error('cancelled'));

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'reauthentication-failed' });
    expect(mocks.fetchDelete).not.toHaveBeenCalled();
  });

  it('does not report an intentional Apple cancellation', async () => {
    mocks.fetchRequirements.mockResolvedValueOnce({ data: { method: 'native' }, error: null });
    mocks.reauthenticateWithApple.mockRejectedValueOnce({ code: 'ERR_REQUEST_CANCELED' });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'reauthentication-failed' });
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(mocks.fetchDelete).not.toHaveBeenCalled();
  });

  it('reports IdP token acquisition separately from the native provider', async () => {
    mocks.fetchRequirements.mockResolvedValueOnce({ data: { method: 'native' }, error: null });
    mocks.reauthenticateWithApple.mockRejectedValueOnce(
      new mocks.IdpTokenAcquisitionError('IdP unavailable'),
    );

    await deleteAccount();

    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(mocks.IdpTokenAcquisitionError),
      expect.objectContaining({ tags: { account_deletion_stage: 'idp-token' } }),
    );
  });

  it('maps a 401 response to reauthentication-failed', async () => {
    mocks.fetchDelete.mockResolvedValueOnce({ data: null, error: { status: 401 } });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'reauthentication-failed' });
  });

  it('maps a 409 pre-check response to failed, carrying the biz code through', async () => {
    mocks.fetchDelete.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: 'ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER' },
    });

    const result = await deleteAccount();

    expect(result).toEqual({
      kind: 'failed',
      code: 'ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER',
    });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('reports a server failure from the deletion endpoint', async () => {
    mocks.fetchDelete.mockResolvedValueOnce({ data: null, error: { status: 503 } });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'failed' });
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { account_deletion_stage: 'response' } }),
    );
  });

  it('reports an unexpected client error from the deletion endpoint', async () => {
    mocks.fetchDelete.mockResolvedValueOnce({ data: null, error: { status: 403 } });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'failed' });
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { account_deletion_stage: 'response' } }),
    );
  });

  it('treats a pending server response as pending, carrying the reference through', async () => {
    mocks.fetchDelete.mockResolvedValueOnce({
      data: { status: 'pending', reference: 'ref-1' },
      error: null,
    });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'pending', reference: 'ref-1' });
  });

  it('treats a thrown network error as unknown and reports the transport failure', async () => {
    mocks.fetchDelete.mockRejectedValueOnce(new Error('offline'));

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'unknown' });
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { account_deletion_stage: 'transport' } }),
    );
  });

  it('treats an unparseable success response as pending rather than completed', async () => {
    mocks.fetchDelete.mockResolvedValueOnce({ data: { unexpected: true }, error: null });

    const result = await deleteAccount();

    expect(result).toEqual({ kind: 'pending' });
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { account_deletion_stage: 'response' } }),
    );
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
