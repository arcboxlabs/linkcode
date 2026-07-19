import { z } from 'zod';
import { FileSuggestionSchema, WorkspaceFileSchema } from '../model/file';

/** File wire variants — directory-backed: keyed by cwd + path, shared by same-cwd sessions (see file.ts). */
export const fileWireVariants = [
  z.object({
    kind: z.literal('file.read'),
    clientReqId: z.string().min(1),
    /** Directory a relative `path` resolves against (the session's workspace root). */
    cwd: z.string().min(1),
    /** Absolute, or relative to `cwd`; may point outside the workspace. */
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal('file.read.result'),
    replyTo: z.string().min(1),
    file: WorkspaceFileSchema,
  }),
  z.object({
    kind: z.literal('file.list'),
    clientReqId: z.string().min(1),
    /** Workspace root to enumerate; must be a registered workspace
     * (the engine rejects unknown roots — see WorkspaceRegistry). */
    cwd: z.string().min(1),
  }),
  z.object({
    kind: z.literal('file.list.result'),
    replyTo: z.string().min(1),
    /** Every workspace file as a cwd-relative forward-slash path (tracked + untracked-but-not-
     * ignored; enumeration bounds live in the engine's FileSuggestService). Directories are
     * implied by the paths — empty directories are absent, matching git semantics. */
    files: z.array(z.string().min(1)),
  }),
  z.object({
    kind: z.literal('file.suggest'),
    clientReqId: z.string().min(1),
    /** Workspace root the search runs under; must be a registered workspace
     * (the engine rejects unknown roots — see WorkspaceRegistry). */
    cwd: z.string().min(1),
    /** Substring query; empty lists shallow files first (browse mode). */
    query: z.string(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  z.object({
    kind: z.literal('file.suggest.result'),
    replyTo: z.string().min(1),
    suggestions: z.array(FileSuggestionSchema),
  }),
] as const;
