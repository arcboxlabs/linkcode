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
    /** IM platform the session was created from (`SessionRecord.createdVia`); null for LinkCode clients. */
    createdVia: text('created_via'),
    /** Automation that created this session (`SessionRecord.automation`); null for user sessions. */
    automationKind: text('automation_kind', { enum: ['loop', 'schedule'] }),
    automationId: text('automation_id'),
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

/**
 * Recurring automations; mirrors `Schedule` from `@linkcode/schema` (spec fields flattened into
 * columns). `target_session_id` deliberately has no foreign key — a deleted target is the signal the
 * schedule-service's orphan sweep completes the schedule on, not a cascade.
 */
export const schedules = sqliteTable(
  'schedules',
  {
    scheduleId: text('schedule_id').primaryKey(),
    name: text('name'),
    prompt: text('prompt').notNull(),
    cadenceType: text('cadence_type', { enum: ['cron', 'interval'] }).notNull(),
    cronExpression: text('cron_expression'),
    cronTimezone: text('cron_timezone'),
    intervalMs: integer('interval_ms'),
    targetType: text('target_type', { enum: ['session', 'new-session'] }).notNull(),
    targetSessionId: text('target_session_id'),
    /** JSON `{ kind, cwd, model? }` for the `new-session` target. */
    targetConfigJson: text('target_config_json'),
    status: text('status', { enum: ['active', 'paused', 'completed'] }).notNull(),
    completedReason: text('completed_reason', { enum: ['maxRuns', 'expired', 'targetGone'] }),
    nextRunAt: integer('next_run_at'),
    lastRunAt: integer('last_run_at'),
    runCount: integer('run_count').notNull().default(0),
    maxRuns: integer('max_runs'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('schedules_next_run_at_idx').on(table.nextRunAt)],
);

/** One firing of a schedule; mirrors `ScheduleRun`. Runs cascade when their schedule is deleted. */
export const scheduleRuns = sqliteTable(
  'schedule_runs',
  {
    runId: text('run_id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .references(() => schedules.scheduleId, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'skipped'] }).notNull(),
    trigger: text('trigger', { enum: ['cadence', 'manual', 'catch-up'] }).notNull(),
    sessionId: text('session_id'),
    error: text('error'),
    summary: text('summary'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (table) => [index('schedule_runs_schedule_started_idx').on(table.scheduleId, table.startedAt)],
);

/** Registered directories ("workspaces"); mirrors `WorkspaceRecord` from `@linkcode/schema`. */
export const workspaces = sqliteTable(
  'workspaces',
  {
    workspaceId: text('workspace_id').primaryKey(),
    cwd: text('cwd').notNull().unique(),
    name: text('name'),
    kind: text('kind', { enum: ['project', 'chat'] })
      .notNull()
      .default('project'),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
  },
  (table) => [index('workspaces_last_used_at_idx').on(table.lastUsedAt)],
);
