import { z } from 'zod';

/**
 * Ephemeral artifact hosting (CODE-62): the daemon serves an inline artifact's content
 * under its own `artifact--<hash>.localhost` origin through the preview proxy — one
 * origin per artifact, so browser same-origin policy isolates them from each other and
 * from the daemon. Content-addressed, in-memory only: a daemon restart revokes all.
 */

/** Hard cap on hosted content (it crosses the JSON wire and lives in daemon memory). */
export const MAX_ARTIFACT_CONTENT_BYTES = 2 * 1024 * 1024;

export const HostedArtifactSchema = z.object({
  /** Content hash (also the hostname label suffix); re-hosting identical content is idempotent. */
  hash: z.string().min(1),
  hostname: z.string().min(1),
  /** Full URL through the daemon proxy. */
  url: z.string().min(1),
});
export type HostedArtifact = z.infer<typeof HostedArtifactSchema>;
