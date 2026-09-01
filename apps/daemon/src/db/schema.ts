import { sql } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    originType: text('origin_type', { enum: ['created', 'imported', 'forked'] }).notNull(),
    originHistoryId: text('origin_history_id'),
    originImportedAt: integer('origin_imported_at'),
    originSourceSessionId: text('origin_source_session_id'),
    originSourceTurnId: text('origin_source_turn_id'),
    originForkedAt: integer('origin_forked_at'),
    /** IM platform the session was created from (`SessionRecord.createdVia`); null for LinkCode clients. */
    createdVia: text('created_via'),
    /** Automation that created this session (`SessionRecord.automation`); null for user sessions. */
    automationKind: text('automation_kind', { enum: ['loop', 'schedule'] }),
    automationId: text('automation_id'),
    /** Deliberately no FK to `conversation_turns`: the turn tree is written on the conversation
     * store's own connection, and the two tables would otherwise cycle. */
    activeLeafTurnId: text('active_leaf_turn_id'),
    graphRevision: integer('graph_revision').notNull().default(0),
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
    /** Explicit run identity (`SessionRun.runId`); nullable in DDL only because SQLite cannot add a
     * NOT NULL column — the migration backfills every row and the store always writes it. */
    runId: text('run_id'),
    baseTurnId: text('base_turn_id'),
    historyId: text('history_id'),
    /** What the thread is set to, replayed on relaunch (`SessionRunSchema`). Every one of these must
     * round-trip, or a restart silently moves the thread back onto the agent's configured default. */
    accountId: text('account_id'),
    model: text('model'),
    effort: text('effort'),
    approvalPolicyId: text('approval_policy_id'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (table) => [
    index('session_runs_session_id_idx').on(table.sessionId),
    uniqueIndex('session_runs_run_id_unique').on(table.runId),
  ],
);

export const sessionResources = sqliteTable(
  'session_resources',
  {
    resourceId: text('resource_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['source', 'output'] }).notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['file', 'image', 'document', 'site', 'link'] }).notNull(),
    status: text('status', {
      enum: ['processing', 'generating', 'ready', 'failed', 'unavailable'],
    }).notNull(),
    locatorType: text('locator_type', {
      enum: ['managed-file', 'workspace-file', 'url'],
    }).notNull(),
    locator: text('locator').notNull(),
    normalizedLocatorKey: text('normalized_locator_key'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('session_resources_session_idx').on(table.sessionId),
    uniqueIndex('session_resources_locator_idx').on(table.sessionId, table.normalizedLocatorKey),
  ],
);

/**
 * Conversation turn-tree tables. These mirror the `Conversation*` schemas from `@linkcode/schema`
 * and are written ONLY by the conversation store's dedicated connection (../conversation-store.ts):
 * the submit saga's transactions are multi-table, and atomicity across the per-store connections
 * does not exist. Prompt content is user-authored and must never enter logs/telemetry.
 */
export const prompts = sqliteTable('prompts', {
  promptId: text('prompt_id').primaryKey(),
  /** JSON `PromptBlock[]` — references only, never bytes or absolute paths. */
  blocksJson: text('blocks_json').notNull(),
  /** JSON `AttachmentId[]`; ordered snapshot. `prompt_attachment_refs` is the derived GC index. */
  contextAttachmentIdsJson: text('context_attachment_ids_json').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** Refcount edges for attachment GC: every attachment a prompt references, blocks and context. */
export const promptAttachmentRefs = sqliteTable(
  'prompt_attachment_refs',
  {
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.promptId, { onDelete: 'cascade' }),
    attachmentId: text('attachment_id').notNull(),
  },
  (table) => [primaryKey({ columns: [table.promptId, table.attachmentId] })],
);

export const conversationTurns = sqliteTable(
  'conversation_turns',
  {
    turnId: text('turn_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    /** null = child of the session root. Cascade keeps a subtree consistent under session delete. */
    parentTurnId: text('parent_turn_id').references(
      (): AnySQLiteColumn => conversationTurns.turnId,
      {
        onDelete: 'cascade',
      },
    ),
    siblingOrdinal: integer('sibling_ordinal').notNull(),
    inputType: text('input_type', { enum: ['prompt', 'command', 'shell-command'] }).notNull(),
    /** No cascade: a referenced prompt must outlive the reference (shared across forks). */
    promptId: text('prompt_id').references(() => prompts.promptId),
    commandName: text('command_name'),
    commandArguments: text('command_arguments'),
    shellCommand: text('shell_command'),
    runId: text('run_id').notNull(),
    state: text('state', {
      enum: ['preparing', 'dispatching', 'running', 'completed', 'failed', 'cancelled'],
    }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('conversation_turns_session_idx').on(table.sessionId),
    // Ordinal uniqueness needs two partial indexes: SQLite treats NULL parents as distinct rows.
    uniqueIndex('conversation_turns_sibling_unique')
      .on(table.sessionId, table.parentTurnId, table.siblingOrdinal)
      .where(sql`parent_turn_id IS NOT NULL`),
    uniqueIndex('conversation_turns_root_sibling_unique')
      .on(table.sessionId, table.siblingOrdinal)
      .where(sql`parent_turn_id IS NULL`),
  ],
);

/** One row per (turn, provider history); forks re-bind. `checkpoint` is adapter-opaque. */
export const providerTurnBindings = sqliteTable(
  'provider_turn_bindings',
  {
    turnId: text('turn_id')
      .notNull()
      .references(() => conversationTurns.turnId, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    historyId: text('history_id').notNull(),
    checkpoint: text('checkpoint').notNull(),
    capturedFrom: text('captured_from', { enum: ['live', 'replay'] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.turnId, table.historyId] })],
);

/** Idempotency journal for conversation mutations; mirrors `ConversationOperation`. */
export const conversationOperations = sqliteTable(
  'conversation_operations',
  {
    operationId: text('operation_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    state: text('state', { enum: ['open', 'succeeded', 'failed'] }).notNull(),
    turnId: text('turn_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (table) => [
    index('conversation_operations_session_idx').on(table.sessionId),
    uniqueIndex('conversation_operations_open_session_unique')
      .on(table.sessionId)
      .where(sql`state = 'open'`),
  ],
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
    kind: text('kind', { enum: ['project', 'chat', 'worktree'] })
      .notNull()
      .default('project'),
    parentWorkspaceId: text('parent_workspace_id'),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
  },
  (table) => [index('workspaces_last_used_at_idx').on(table.lastUsedAt)],
);

/** Managed git worktrees. Session ids intentionally have no FK: rows survive session deletion until
 * the dedicated cleanup lifecycle owns removal. */
export const worktrees = sqliteTable(
  'worktrees',
  {
    worktreePath: text('worktree_path').primaryKey(),
    repoRoot: text('repo_root').notNull(),
    branch: text('branch').notNull(),
    sessionId: text('session_id').notNull(),
    createdAt: integer('created_at').notNull(),
    state: text('state', { enum: ['active', 'orphaned'] }).notNull(),
  },
  (table) => [
    uniqueIndex('worktrees_repo_root_branch_unique').on(table.repoRoot, table.branch),
    uniqueIndex('worktrees_session_id_unique').on(table.sessionId),
  ],
);
