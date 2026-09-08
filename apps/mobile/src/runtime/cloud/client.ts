import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

/**
 * The single better-auth client for LinkCode Cloud: session cookie in SecureStore,
 * OAuth in the system browser landing back through the `linkcode://` scheme.
 *
 * `EXPO_PUBLIC_CLOUD_URL` (an Expo built-in inlined-at-build-time env var, set via
 * `.env.local` — gitignored, never committed) overrides the production origin for a
 * local dev build pointed at a local `svc dev` stack.
 * Unset in any build that isn't explicitly configured for local dev, so production
 * and EAS builds are unaffected.
 */
export const CLOUD_URL = process.env.EXPO_PUBLIC_CLOUD_URL ?? 'https://api.linkcode.ai';

export const cloudAuthClient = createAuthClient({
  baseURL: `${CLOUD_URL}/auth`,
  plugins: [
    expoClient({
      scheme: 'linkcode',
      storagePrefix: 'linkcode',
      storage: SecureStore,
    }),
  ],
});

/** Fresh short-lived tunnel JWT; the TunnelTransport calls this per (re)connect. */
export async function fetchTunnelJwt(): Promise<string> {
  const { data, error } = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/auth/token`, {});
  if (error) throw new Error(`tunnel token refresh failed (${error.status})`);
  const parsed = z.object({ token: z.string().min(1) }).safeParse(data);
  if (!parsed.success) throw new Error('token endpoint returned an unexpected shape');
  return parsed.data.token;
}
