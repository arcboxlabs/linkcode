import { z } from 'zod';
import { SessionIdSchema, TimestampSchema } from './primitives';

export const SessionResourceIdSchema = z.string().min(1).brand<'SessionResourceId'>();
export type SessionResourceId = z.infer<typeof SessionResourceIdSchema>;

export const SessionResourceLocatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('managed-file'), path: z.string().min(1) }),
  z.object({ type: z.literal('workspace-file'), path: z.string().min(1) }),
  z.object({ type: z.literal('url'), url: z.url() }),
]);
export type SessionResourceLocator = z.infer<typeof SessionResourceLocatorSchema>;

export const SessionResourceSchema = z.object({
  resourceId: SessionResourceIdSchema,
  sessionId: SessionIdSchema,
  direction: z.enum(['source', 'output']),
  name: z.string().min(1),
  kind: z.enum(['file', 'image', 'document', 'site', 'link']),
  status: z.enum(['processing', 'generating', 'ready', 'failed', 'unavailable']),
  locator: SessionResourceLocatorSchema,
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  error: z.string().min(1).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type SessionResource = z.infer<typeof SessionResourceSchema>;

export const HostedSessionResourceSchema = z.object({ url: z.url() });
export type HostedSessionResource = z.infer<typeof HostedSessionResourceSchema>;
