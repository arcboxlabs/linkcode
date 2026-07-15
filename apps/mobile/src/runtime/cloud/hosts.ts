import { z } from 'zod';
import { CLOUD_URL, cloudAuthClient } from './client';

export const OnlineHostSchema = z.object({
  hostId: z.string().min(1),
  name: z.string().nullable(),
  connectedAt: z.number(),
  lastSeen: z.number(),
});
export type OnlineHost = z.infer<typeof OnlineHostSchema>;

/** The account's hosts currently connected to the relay (`GET /tunnel/hosts`). */
export async function fetchOnlineHosts(): Promise<OnlineHost[]> {
  const { data, error } = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/tunnel/hosts`, {});
  if (error) throw new Error(`host discovery failed (${error.status})`);
  const parsed = z.object({ hosts: z.array(OnlineHostSchema) }).safeParse(data);
  if (!parsed.success) throw new Error('host list returned an unexpected shape');
  return parsed.data.hosts;
}
