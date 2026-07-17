import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import { CLOUD_URL, cloudAuthClient } from './client';

/**
 * Browserless sign-in: Apple identityToken → central IdP (this bundle id is on its
 * audience whitelist) → short-lived IdP JWT → cloud session at `/auth/exchange/idp-token`.
 * The IdP session has its own SecureStore slot; signing out of the cloud never touches it.
 */

const IDP_URL = 'https://auth.arcbox.dev';

const idpAuthClient = createAuthClient({
  baseURL: `${IDP_URL}/api/auth`,
  plugins: [
    expoClient({
      scheme: 'linkcode',
      storagePrefix: 'arcbox-idp',
      storage: SecureStore,
    }),
  ],
});

export async function signInWithApple(): Promise<void> {
  // Fresh nonce per attempt: Apple embeds the SHA-256 we hand it into the
  // id_token; the IdP re-hashes the raw value we send and compares.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential.identityToken) {
    throw new Error('Apple sign-in returned no identity token');
  }

  // Apple only discloses the name on the very first authorization — forward
  // it so the IdP profile starts populated instead of empty.
  const { givenName, familyName } = credential.fullName ?? {};
  const signedIn = await idpAuthClient.signIn.social({
    provider: 'apple',
    idToken: {
      token: credential.identityToken,
      nonce: rawNonce,
      ...((givenName || familyName) && {
        user: {
          name: {
            firstName: givenName ?? undefined,
            lastName: familyName ?? undefined,
          },
        },
      }),
    },
  });
  if (signedIn.error) {
    throw new Error(`IdP sign-in failed (${signedIn.error.status})`);
  }

  const jwt = await idpAuthClient.$fetch<unknown>(`${IDP_URL}/api/auth/token`, {});
  if (jwt.error) throw new Error(`IdP token mint failed (${jwt.error.status})`);
  const parsed = z.object({ token: z.string().min(1) }).safeParse(jwt.data);
  if (!parsed.success) throw new Error('IdP token endpoint returned an unexpected shape');

  // Exchange on the cloud client so its response hook captures the session
  // cookie into SecureStore and flips `useSession` reactively.
  const exchanged = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/auth/exchange/idp-token`, {
    method: 'POST',
    body: { token: parsed.data.token },
  });
  if (exchanged.error) {
    throw new Error(`cloud token exchange failed (${exchanged.error.status})`);
  }
}

/** Apple's dismissal surfaces as an exception — a non-event, not a failure. */
export function isAppleSignInCancel(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_REQUEST_CANCELED'
  );
}
