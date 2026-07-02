import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Session registry tables. These mirror `SessionRecord` from `@linkcode/schema` — the zod schema
 * stays the contract; rows are validated back through it on load (see ../session-store.ts).
 */

export const sessions = sqliteTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey(),
    kind: text('kind').notNull(),
    cwd: text('cwd').notNull(),
    title: text('title'),
    originType: text('origin_type', { enum: ['created', 'imported'] }).notNull(),
    originHistoryId: text('origin_history_id'),
    originImportedAt: integer('origin_imported_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('sessions_updated_at_idx').on(table.updatedAt)],
);

export const sessionRuns = sqliteTable(
  'session_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    /** Position within the session's run list — array order is part of the record. */
    seq: integer('seq').notNull(),
    historyId: text('history_id'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (table) => [index('session_runs_session_id_idx').on(table.sessionId)],
);

/** Registered directories ("workspaces"); mirrors `WorkspaceRecord` from `@linkcode/schema`. */
export const workspaces = sqliteTable(
  'workspaces',
  {
    workspaceId: text('workspace_id').primaryKey(),
    cwd: text('cwd').notNull().unique(),
    name: text('name'),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
  },
  (table) => [index('workspaces_last_used_at_idx').on(table.lastUsedAt)],
);
