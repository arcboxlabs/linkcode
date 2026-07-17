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
