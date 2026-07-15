import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

/**
 * The LinkCode HQ auth client: one better-auth client for the whole app, its
 * session cookie kept in SecureStore, OAuth running in the system browser and
 * landing back through the `linkcode://` scheme. Account state, device
 * enrollment, and host discovery each build on this from their own module.
 */

export const HQ_URL = 'https://api.linkcode.ai';

export const hqAuthClient = createAuthClient({
  baseURL: `${HQ_URL}/auth`,
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
  const { data, error } = await hqAuthClient.$fetch<unknown>(`${HQ_URL}/auth/token`, {});
  if (error) throw new Error(`tunnel token refresh failed (${error.status})`);
  const parsed = z.object({ token: z.string().min(1) }).safeParse(data);
  if (!parsed.success) throw new Error('token endpoint returned an unexpected shape');
  return parsed.data.token;
}
