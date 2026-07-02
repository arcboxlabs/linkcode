import { z } from 'zod';
import { TimestampSchema, WorkspaceIdSchema } from './common';

/**
 * `project`: a directory the user explicitly registered (Add-workspace form / picker).
 * `chat`: the single daemon-owned chat root (`~/LinkCode`) backing the sidebar's "Chats" section —
 * a fixed system entry, not something the user manages (see {@link WorkspaceRecordSchema}).
 */
export const WorkspaceKindSchema = z.enum(['project', 'chat']);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

/**
 * A workspace is a registered directory: the persisted identity behind "recent directories", kept
 * independent of any particular session (a directory can outlive every session started in it, and
 * a session's `cwd` is still the source of truth for where it actually runs).
 */
export const WorkspaceRecordSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  cwd: z.string().min(1),
  /** Derived from the path's last segment when not set explicitly. */
  name: z.string().min(1).optional(),
  /** Absent on records from before this field existed, or from an older client — read via {@link workspaceKind}. */
  kind: WorkspaceKindSchema.optional(),
  createdAt: TimestampSchema,
  lastUsedAt: TimestampSchema,
});
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;

/** `record.kind`, defaulting to `'project'` when absent (see {@link WorkspaceRecordSchema.kind}). */
export function workspaceKind(record: Pick<WorkspaceRecord, 'kind'>): WorkspaceKind {
  return record.kind ?? 'project';
}

const TRAILING_SEPARATORS_RE = /[/\\]+$/;
const DRIVE_ROOT_RE = /^[a-z]:$/i;

/**
 * Normalize a `cwd` into the key workspaces are deduped/looked-up by. This only strips trailing
 * path separators (`/repo/` and `/repo` collapse to the same key) while keeping a bare root
 * (`/`, `C:\`) intact — stripping its only separator would turn it into an empty or drive-relative
 * path, a different location. Nothing else is normalized (no case-folding, no symlink resolution):
 * `cwd` is user-chosen filesystem input and its display value must stay verbatim.
 */
export function normalizeCwdKey(cwd: string): string {
  if (cwd.length === 0) return cwd;
  const stripped = cwd.replace(TRAILING_SEPARATORS_RE, '');
  if (stripped.length > 0 && !DRIVE_ROOT_RE.test(stripped)) return stripped;
  return `${stripped}${cwd.at(-1)}`;
}
