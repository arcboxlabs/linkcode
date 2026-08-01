import { SessionIdSchema } from '@linkcode/schema';
import { z } from 'zod';

const NotificationDataSchema = z.object({
  tunnelHostId: z.string().min(1),
  sessionId: SessionIdSchema,
});

interface NotificationHost {
  id: string;
  tunnelHostId?: string;
}

export function resolveNotificationRoute(
  data: unknown,
  hosts: readonly NotificationHost[],
): string | null {
  const parsed = NotificationDataSchema.safeParse(data);
  if (!parsed.success) return null;
  const host = hosts.find((candidate) => candidate.tunnelHostId === parsed.data.tunnelHostId);
  if (!host) return '/connect';
  return `/host/${encodeURIComponent(host.id)}/session/${encodeURIComponent(parsed.data.sessionId)}`;
}
