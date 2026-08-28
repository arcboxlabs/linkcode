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

// See `client.ts`'s `CLOUD_URL` for the `EXPO_PUBLIC_*` override convention this mirrors.
const IDP_URL = process.env.EXPO_PUBLIC_IDP_URL ?? 'https://auth.arcbox.dev';

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

interface AppleNativeAuthentication {
  /** A fresh, short-lived IdP JWT (`GET /api/auth/token`) naming this account's central identity. */
  idpToken: string;
  /** Apple's single-use, 5-minute authorization code from this same authentication — the
   * account-deletion flow's only use for it (CODE-292 D-7). */
  authorizationCode: string;
}

export class IdpTokenAcquisitionError extends Error {
  override name = 'IdpTokenAcquisitionError';
}

/**
 * The shared core of both the sign-in and the account-deletion re-authentication
 * flows: prove the user is present via Face ID / passcode through Apple's native
 * sheet, sign that proof in to the central IdP, and mint a fresh IdP JWT from the
 * resulting session. Callers decide what happens next (exchange to a cloud
 * session, or hand the JWT to a delete request) — this never touches `cloudAuthClient`.
 */
async function authenticateWithAppleNatively(): Promise<AppleNativeAuthentication> {
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
    state: rawNonce,
  });
  if (credential.state !== rawNonce) {
    throw new Error('Apple sign-in returned a mismatched state — possible replay');
  }
  if (!credential.identityToken) {
    throw new Error('Apple sign-in returned no identity token');
  }
  if (!credential.authorizationCode) {
    throw new Error('Apple sign-in returned no authorization code');
  }

  // Apple only discloses the name on the very first authorization — forward
  // it so the IdP profile starts populated instead of empty.
  const { givenName, familyName } = credential.fullName ?? {};
  try {
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

    return { idpToken: parsed.data.token, authorizationCode: credential.authorizationCode };
  } catch (error) {
    throw new IdpTokenAcquisitionError('Could not acquire an IdP token', { cause: error });
  }
}

export async function signInWithApple(): Promise<void> {
  const { idpToken } = await authenticateWithAppleNatively();

  // Exchange on the cloud client so its response hook captures the session
  // cookie into SecureStore and flips `useSession` reactively.
  const exchanged = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/auth/exchange/idp-token`, {
    method: 'POST',
    body: { token: idpToken },
  });
  if (exchanged.error) {
    throw new Error(`cloud token exchange failed (${exchanged.error.status})`);
  }
}

/**
 * Account-deletion re-authentication for Apple-signed-in accounts (CODE-292
 * D-5/D-19): re-proves presence and returns both the fresh IdP JWT (identity
 * proof) and the fresh `authorizationCode` (Apple revocation credential) —
 * never touching the cloud session, which the delete request itself replaces.
 */
export const reauthenticateWithApple = authenticateWithAppleNatively;

/**
 * Clears the IdP's own SecureStore session (`arcbox-idp` prefix) — never
 * touched by `signOutOfCloud()`, which only knows about the cloud session
 * (CODE-292 §3.5). Best-effort: a failure here doesn't roll back anything.
 */
export async function signOutOfIdp(): Promise<void> {
  await idpAuthClient.signOut();
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
