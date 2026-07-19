import { z } from 'zod';
import { HostedArtifactSchema, MAX_ARTIFACT_CONTENT_BYTES } from '../model/artifact';
import { WireRequestIdSchema } from './request';

/** Ephemeral artifact hosting wire variants — content-addressed, in-memory (see artifact.ts). */
export const artifactWireVariants = [
  z.object({
    kind: z.literal('artifact.host'),
    clientReqId: WireRequestIdSchema,
    content: z.string().max(MAX_ARTIFACT_CONTENT_BYTES),
    mimeType: z.string().min(1),
  }),
  z.object({
    kind: z.literal('artifact.hosted'),
    replyTo: WireRequestIdSchema,
    artifact: HostedArtifactSchema,
  }),
  /** Drop hosted content early (before the LRU/daemon restart would); ack via request.succeeded. */
  z.object({
    kind: z.literal('artifact.revoke'),
    clientReqId: WireRequestIdSchema,
    hash: z.string().min(1),
  }),
] as const;
