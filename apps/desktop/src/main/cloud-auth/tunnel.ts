import type { CloudHost } from '@linkcode/workbench';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { CLOUD_LIST_HOSTS_CHANNEL } from '../../shared/cloud';
import { authClient, CLOUD_API_URL } from './client';

const hostsResponseSchema = z.object({
  hosts: z.array(
    z.object({
      hostId: z.string(),
      name: z.string().nullable(),
      connectedAt: z.number(),
      lastSeen: z.number(),
    }),
  ),
});

/**
 * List the signed-in account's online hosts (`GET /tunnel/hosts`). The keychain session lives in
 * main (the renderer never talks to the cloud API — see client.ts), so attach it here and hand
 * back only the validated list. Throws on non-2xx so SWR surfaces it; callers gate on a live session.
 */
export async function listCloudHosts(): Promise<CloudHost[]> {
  const res = await fetch(`${CLOUD_API_URL}/tunnel/hosts`, {
    headers: { cookie: authClient.getCookie() },
  });
  if (!res.ok) throw new Error(`listCloudHosts: ${res.status} ${res.statusText}`);
  return hostsResponseSchema.parse(await res.json()).hosts;
}

/** Registers the cloud-data IPC the preload's `linkcodeCloud` bridge invokes. */
export function registerCloudTunnelBridge(): void {
  ipcMain.handle(CLOUD_LIST_HOSTS_CHANNEL, () => listCloudHosts());
}
