import { SessionIdSchema } from '@linkcode/schema';
import { z } from 'zod';

const NotificationDataSchema = z.object({
  hostId: z.string().min(1),
  sessionId: SessionIdSchema,
});

interface NotificationHost {
  id: string;
  tunnelHostId?: string;
}

export type NotificationTarget =
  | { type: 'connect' }
  | { type: 'session'; hostId: string; sessionId: z.infer<typeof SessionIdSchema> };

export function resolveNotificationRoute(
  data: unknown,
  hosts: readonly NotificationHost[],
): NotificationTarget | null {
  const parsed = NotificationDataSchema.safeParse(data);
  if (!parsed.success) return null;
  const host = hosts.find((candidate) => candidate.tunnelHostId === parsed.data.hostId);
  if (!host) return { type: 'connect' };
  return { type: 'session', hostId: host.id, sessionId: parsed.data.sessionId };
}
