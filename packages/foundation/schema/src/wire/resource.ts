import { z } from 'zod';
import { MAX_ATTACHMENT_BYTES } from '../model/content';
import { SessionIdSchema } from '../model/primitives';
import {
  HostedSessionResourceSchema,
  SessionResourceIdSchema,
  SessionResourceSchema,
} from '../model/session-resource';
import { WireRequestIdSchema } from './request';

export const resourceWireVariants = [
  z.object({
    kind: z.literal('resource.list'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
  }),
  z.object({
    kind: z.literal('resource.listed'),
    replyTo: WireRequestIdSchema,
    resources: z.array(SessionResourceSchema),
  }),
  z.object({
    kind: z.literal('resource.source.upload'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    name: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    data: z.string().max(4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3)),
  }),
  z.object({
    kind: z.literal('resource.uploaded'),
    replyTo: WireRequestIdSchema,
    resource: SessionResourceSchema,
  }),
  z.object({
    kind: z.literal('resource.remove'),
    clientReqId: WireRequestIdSchema,
    resourceId: SessionResourceIdSchema,
  }),
  z.object({
    kind: z.literal('resource.host'),
    clientReqId: WireRequestIdSchema,
    resourceId: SessionResourceIdSchema,
  }),
  z.object({
    kind: z.literal('resource.hosted'),
    replyTo: WireRequestIdSchema,
    hosted: HostedSessionResourceSchema,
  }),
  z.object({ kind: z.literal('resource.changed'), resource: SessionResourceSchema }),
  z.object({
    kind: z.literal('resource.removed'),
    resourceId: SessionResourceIdSchema,
    sessionId: SessionIdSchema,
  }),
] as const;
