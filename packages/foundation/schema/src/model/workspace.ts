import { z } from 'zod';
import { TimestampSchema, WorkspaceIdSchema } from './primitives';

/** `project`: a directory the user explicitly registered. `chat`: the single daemon-owned chat
 * root (`~/LinkCode`) backing the sidebar's "Chats" section — a fixed system entry the user
 * doesn't manage. */
export const WorkspaceKindSchema = z.enum(['project', 'chat']);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

/** A workspace is a registered directory: the persisted identity behind "recent directories",
 * independent of any session — a session's `cwd` remains the source of truth for where it runs. */
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

/** Normalize a `cwd` into the dedupe/lookup key: only strips trailing separators, keeping a bare
 * root (`/`, `C:\`) intact — stripping its only separator would name a different location. No
 * case-folding or symlink resolution: `cwd` is user-chosen input and must stay verbatim. */
export function normalizeCwdKey(cwd: string): string {
  if (cwd.length === 0) return cwd;
  const stripped = cwd.replace(TRAILING_SEPARATORS_RE, '');
  if (stripped.length > 0 && !DRIVE_ROOT_RE.test(stripped)) return stripped;
  return `${stripped}${cwd.at(-1)}`;
}
