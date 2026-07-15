import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';
import { HQ_URL, hqAuthClient } from './client';

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
