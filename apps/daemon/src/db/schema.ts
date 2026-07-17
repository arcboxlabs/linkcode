import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    /** Per-schedule missed-window override (`ScheduleSpec.misfirePolicy`); null follows the daemon default. */
    misfirePolicy: text('misfire_policy', { enum: ['skip', 'catch-up'] }),
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

/**
 * Iterate-until-verified loops; mirrors `LoopRecord` from `@linkcode/schema`. The spec carries arrays
 * (`verifyChecks`) and a nested `verifier`, so it is stored as one JSON column and validated back
 * through `LoopSpecSchema` on load rather than being flattened into columns.
 */
export const loops = sqliteTable('loops', {
  loopId: text('loop_id').primaryKey(),
  /** JSON `LoopSpec`. */
  specJson: text('spec_json').notNull(),
  status: text('status', { enum: ['running', 'succeeded', 'failed', 'stopped'] }).notNull(),
  iterationCount: integer('iteration_count').notNull().default(0),
  error: text('error'),
  summary: text('summary'),
  startedAt: integer('started_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  endedAt: integer('ended_at'),
});

/** One iteration of a loop; mirrors `LoopIteration`. Iterations cascade when their loop is deleted. */
export const loopIterations = sqliteTable(
  'loop_iterations',
  {
    loopId: text('loop_id')
      .notNull()
      .references(() => loops.loopId, { onDelete: 'cascade' }),
    /** Zero-based iteration index; unique within the loop. */
    index: integer('index').notNull(),
    status: text('status', { enum: ['running', 'passed', 'failed'] }).notNull(),
    workerSessionId: text('worker_session_id'),
    verifierSessionId: text('verifier_session_id'),
    /** JSON array of `LoopCheckResult`. */
    checksJson: text('checks_json').notNull(),
    /** JSON `LoopVerdict`, when a verifier ran. */
    verdictJson: text('verdict_json'),
    error: text('error'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (table) => [primaryKey({ columns: [table.loopId, table.index] })],
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
