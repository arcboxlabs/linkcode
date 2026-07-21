import { z } from 'zod';

/** Workspace file reads (directory-backed like git.*: keyed by cwd + path, shared by same-cwd
 * sessions). Text travels utf8; anything failing the binary sniff travels base64 so the JSON wire
 * stays valid. */
export const WorkspaceFileSchema = z.object({
  /** Normalized absolute path (realpath) of the file that was read. */
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  encoding: z.enum(['utf8', 'base64']),
  content: z.string(),
  /** Extension-derived; absent when the extension is unknown. */
  mimeType: z.string().optional(),
});
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

/** One workspace-file match from `file.suggest` (the composer's @-mention source). */
export const FileSuggestionSchema = z.object({
  /** cwd-relative path, forward slashes. */
  path: z.string().min(1),
});
export type FileSuggestion = z.infer<typeof FileSuggestionSchema>;

/**
 * A workspace file the daemon streams over the preview proxy (CODE-316): its own
 * `file--<hash>.localhost` origin, served with HTTP Range so large media (video) plays in the
 * host's browser without a full download. Path-addressed, revoked on daemon restart.
 */
export const HostedFileSchema = z.object({
  /** Absolute-path hash (also the hostname label); re-hosting the same path is idempotent. */
  hash: z.string().min(1),
  hostname: z.string().min(1),
  /** Full URL through the daemon proxy. */
  url: z.string().min(1),
});
export type HostedFile = z.infer<typeof HostedFileSchema>;
