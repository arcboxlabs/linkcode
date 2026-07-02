import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

/**
 * The LinkCode HQ account layer: one better-auth client (session cookie kept
 * in SecureStore, OAuth through the system browser and back via the
 * `linkcode://` scheme) plus the small REST surface the app needs — device
 * registration, online-host discovery, and the tunnel-JWT exchange the
 * TunnelTransport dials with.
 */

export const HQ_URL = 'https://api.linkcode.ai';

/** HQ's genericOAuth provider id — the central IdP is the only sign-in path. */
const IDP_PROVIDER_ID = 'central-idp';

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

export function signInToHq(): Promise<unknown> {
  // Generic OAuth shares the social sign-in flow as of better-auth 1.7. The
  // system browser runs the IdP flow; the deep link lands back on /connect.
  return hqAuthClient.signIn.social({ provider: IDP_PROVIDER_ID, callbackURL: '/connect' });
}

export function signOutOfHq(): Promise<unknown> {
  return hqAuthClient.signOut();
}

const REGISTERED_DEVICE_KEY = 'linkcode.hq.device-id';

/**
 * Register this phone in HQ's device registry once per install. Registration
 * is what lists the phone under the account's devices (and lets it be
 * revoked); connecting to hosts works either way, so failures stay silent
 * until the next attempt.
 */
export async function ensureDeviceRegistered(): Promise<void> {
  if (await SecureStore.getItemAsync(REGISTERED_DEVICE_KEY)) return;
  const { data, error } = await hqAuthClient.$fetch<unknown>(`${HQ_URL}/devices`, {
    method: 'POST',
    body: {
      kind: 'mobile',
      name: Device.deviceName ?? Device.modelName ?? 'Mobile',
      platform: Platform.OS,
    },
  });
  if (error) throw new Error(`device registration failed (${error.status})`);
  const parsed = z.object({ id: z.string().min(1) }).safeParse(data);
  if (!parsed.success) throw new Error('device registration returned an unexpected shape');
  await SecureStore.setItemAsync(REGISTERED_DEVICE_KEY, parsed.data.id);
}

/** Fresh short-lived tunnel JWT; the TunnelTransport calls this per (re)connect. */
export async function fetchTunnelJwt(): Promise<string> {
  const { data, error } = await hqAuthClient.$fetch<unknown>(`${HQ_URL}/auth/token`, {});
  if (error) throw new Error(`tunnel token refresh failed (${error.status})`);
  const parsed = z.object({ token: z.string().min(1) }).safeParse(data);
  if (!parsed.success) throw new Error('token endpoint returned an unexpected shape');
  return parsed.data.token;
}

export const OnlineHostSchema = z.object({
  hostId: z.string().min(1),
  name: z.string().nullable(),
  connectedAt: z.number(),
  lastSeen: z.number(),
});
export type OnlineHost = z.infer<typeof OnlineHostSchema>;

/** The account's hosts currently connected to the relay (`GET /tunnel/hosts`). */
export async function fetchOnlineHosts(): Promise<OnlineHost[]> {
  const { data, error } = await hqAuthClient.$fetch<unknown>(`${HQ_URL}/tunnel/hosts`, {});
  if (error) throw new Error(`host discovery failed (${error.status})`);
  const parsed = z.object({ hosts: z.array(OnlineHostSchema) }).safeParse(data);
  if (!parsed.success) throw new Error('host list returned an unexpected shape');
  return parsed.data.hosts;
}
