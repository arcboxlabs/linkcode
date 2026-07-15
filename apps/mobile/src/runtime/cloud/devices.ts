import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';
import { CLOUD_URL, cloudAuthClient } from './client';

/**
 * Device enrollment and registry access. Mobile enrollment is keyless (no
 * device keypair yet), so every POST inserts a fresh registry row — the
 * SecureStore enrollment record both prevents duplicates and pins which row
 * is this phone. It remembers the enrolling user so a different account
 * signing in re-enrolls under itself.
 */

const ENROLLMENT_KEY = 'linkcode.cloud.device:v2';

const EnrollmentSchema = z.object({
  deviceId: z.string().min(1),
  userId: z.string().min(1),
});

async function readEnrollment(): Promise<z.infer<typeof EnrollmentSchema> | null> {
  const raw = await SecureStore.getItemAsync(ENROLLMENT_KEY);
  if (!raw) return null;
  try {
    const parsed = EnrollmentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Register this phone in the cloud device registry once per (install, account).
 * Registration is what lists the phone under the account's devices (and lets
 * it be revoked); connecting to hosts works either way, so callers treat
 * failures as best-effort until the next attempt.
 */
export async function ensureDeviceRegistered(userId: string): Promise<void> {
  const enrollment = await readEnrollment();
  if (enrollment?.userId === userId) return;
  const { data, error } = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/devices`, {
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
  await SecureStore.setItemAsync(
    ENROLLMENT_KEY,
    JSON.stringify({ deviceId: parsed.data.id, userId }),
  );
}

/** The registry row id this phone enrolled as, if it has enrolled. */
export async function getEnrolledDeviceId(): Promise<string | null> {
  return (await readEnrollment())?.deviceId ?? null;
}

export async function clearDeviceEnrollment(): Promise<void> {
  await SecureStore.deleteItemAsync(ENROLLMENT_KEY);
}

/** Client view of cloud device rows; timestamps arrive as ISO strings over JSON. */
export const CloudDeviceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['daemon', 'desktop', 'mobile']),
  name: z.string(),
  platform: z.string().nullable(),
  clientVersion: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
});
export type CloudDevice = z.infer<typeof CloudDeviceSchema>;

/** The account's active (non-revoked) devices (`GET /devices`). */
export async function fetchDevices(): Promise<CloudDevice[]> {
  const { data, error } = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/devices`, {});
  if (error) throw new Error(`device list failed (${error.status})`);
  const parsed = z.object({ devices: z.array(CloudDeviceSchema) }).safeParse(data);
  if (!parsed.success) throw new Error('device list returned an unexpected shape');
  return parsed.data.devices;
}

/** Revoke a device: the cloud soft-deletes the row and kills its sessions. */
export async function revokeDevice(id: string): Promise<void> {
  const { error } = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/devices/${id}/revoke`, {
    method: 'POST',
  });
  if (error) throw new Error(`device revoke failed (${error.status})`);
}
