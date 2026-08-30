import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appleSignIn: vi.fn(),
  idpFetch: vi.fn(),
  idpSignIn: vi.fn(),
  cloudFetch: vi.fn(),
}));

vi.mock('@better-auth/expo/client', () => ({ expoClient: vi.fn(() => ({})) }));
vi.mock('better-auth/react', () => ({
  createAuthClient: vi.fn(() => ({
    $fetch: mocks.idpFetch,
    signIn: { social: mocks.idpSignIn },
    signOut: vi.fn(),
  })),
}));
vi.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: vi.fn(() => Promise.resolve(true)),
  signInAsync: mocks.appleSignIn,
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: vi.fn(() => Promise.resolve('hashed-nonce')),
  randomUUID: vi.fn(() => 'nonce'),
}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('../client', () => ({
  CLOUD_URL: 'https://api.linkcode.ai',
  cloudAuthClient: { $fetch: mocks.cloudFetch },
}));

import { reauthenticateWithApple, signInWithApple } from '../idp';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appleSignIn.mockResolvedValue({
    authorizationCode: null,
    fullName: null,
    identityToken: 'apple-token',
    state: 'nonce',
  });
  mocks.idpSignIn.mockResolvedValue({ error: null });
  mocks.idpFetch.mockResolvedValue({ data: { token: 'idp-token' }, error: null });
  mocks.cloudFetch.mockResolvedValue({ data: {}, error: null });
});

describe('Apple authorization code requirements', () => {
  it('allows ordinary sign-in when Apple returns no authorization code', async () => {
    await expect(signInWithApple()).resolves.toBeUndefined();

    expect(mocks.cloudFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects deletion re-authentication when Apple returns no authorization code', async () => {
    await expect(reauthenticateWithApple()).rejects.toThrow(
      'Apple sign-in returned no authorization code',
    );
  });
});
