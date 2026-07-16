import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScheduleStore } from '@linkcode/engine';
import type { Schedule, ScheduleId, ScheduleRun } from '@linkcode/schema';
import { ScheduleRunSchema, ScheduleSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { scheduleRuns, schedules } from './db/schema';

type ScheduleRow = typeof schedules.$inferSelect;
type ScheduleRunRow = typeof scheduleRuns.$inferSelect;

/**
 * SQLite-backed `ScheduleStore` (drizzle over better-sqlite3), sharing the daemon's registry database
 * at `~/.linkcode/daemon.db`. Rows are validated back through `ScheduleSchema`/`ScheduleRunSchema` on
 * load — the zod schema stays the contract; the tables are just its storage shape. A row that fails
 * validation is dropped and logged rather than blanking the rest.
 */
export function createScheduleStore(dbPath: string): ScheduleStore {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Sqlite(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

  return {
    load(): Promise<Schedule[]> {
      return Promise.resolve(parseAll(db.select().from(schedules).all(), toSchedule));
    },

    save(schedule: Schedule): Promise<void> {
      const row = toScheduleRow(schedule);
      db.insert(schedules)
        .values(row)
        .onConflictDoUpdate({ target: schedules.scheduleId, set: row })
        .run();
      return Promise.resolve();
    },

    delete(scheduleId: ScheduleId): Promise<void> {
      // Runs cascade via the foreign key.
      db.delete(schedules).where(eq(schedules.scheduleId, scheduleId)).run();
      return Promise.resolve();
    },

    loadRuns(scheduleId: ScheduleId, limit?: number): Promise<ScheduleRun[]> {
      const base = db
        .select()
        .from(scheduleRuns)
        .where(eq(scheduleRuns.scheduleId, scheduleId))
        .orderBy(desc(scheduleRuns.startedAt));
      const rows = limit === undefined ? base.all() : base.limit(limit).all();
      return Promise.resolve(parseAll(rows, toRun));
    },

    loadRunningRuns(): Promise<ScheduleRun[]> {
      const rows = db.select().from(scheduleRuns).where(eq(scheduleRuns.status, 'running')).all();
      return Promise.resolve(parseAll(rows, toRun));
    },

    saveRun(run: ScheduleRun): Promise<void> {
      const row = toRunRow(run);
      db.insert(scheduleRuns)
        .values(row)
        .onConflictDoUpdate({ target: scheduleRuns.runId, set: row })
        .run();
      return Promise.resolve();
    },

    pruneRuns(scheduleId: ScheduleId, keep: number): Promise<void> {
      const kept = db
        .select({ runId: scheduleRuns.runId })
        .from(scheduleRuns)
        .where(eq(scheduleRuns.scheduleId, scheduleId))
        .orderBy(desc(scheduleRuns.startedAt))
        .limit(keep)
        .all()
        .map((row) => row.runId);
      db.delete(scheduleRuns)
        .where(and(eq(scheduleRuns.scheduleId, scheduleId), notInArray(scheduleRuns.runId, kept)))
        .run();
      return Promise.resolve();
    },
  };
}

/** Parse each row through its schema; drop and log a row that fails rather than failing the load. */
function parseAll<Row, T>(rows: Row[], parse: (row: Row) => T): T[] {
  const parsed: T[] = [];
  for (const row of rows) {
    try {
      parsed.push(parse(row));
    } catch (err) {
      console.error('Dropping malformed schedule row:', err);
    }
  }
  return parsed;
}

function toScheduleRow(schedule: Schedule): typeof schedules.$inferInsert {
  const { spec } = schedule;
  return {
    scheduleId: schedule.scheduleId,
    name: spec.name ?? null,
    prompt: spec.prompt,
    cadenceType: spec.cadence.type,
    cronExpression: spec.cadence.type === 'cron' ? spec.cadence.expression : null,
    cronTimezone: spec.cadence.type === 'cron' ? (spec.cadence.timezone ?? null) : null,
    intervalMs: spec.cadence.type === 'interval' ? spec.cadence.everyMs : null,
    targetType: spec.target.type,
    targetSessionId: spec.target.type === 'session' ? spec.target.sessionId : null,
    targetConfigJson:
      spec.target.type === 'new-session' ? JSON.stringify(spec.target.config) : null,
    status: schedule.status,
    completedReason: schedule.completedReason ?? null,
    nextRunAt: schedule.nextRunAt ?? null,
    lastRunAt: schedule.lastRunAt ?? null,
    runCount: schedule.runCount,
    maxRuns: spec.maxRuns ?? null,
    expiresAt: spec.expiresAt ?? null,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

function toSchedule(row: ScheduleRow): Schedule {
  const cadence =
    row.cadenceType === 'cron'
      ? { type: 'cron', expression: row.cronExpression, timezone: row.cronTimezone ?? undefined }
      : { type: 'interval', everyMs: row.intervalMs };
  const target =
    row.targetType === 'session'
      ? { type: 'session', sessionId: row.targetSessionId }
      : { type: 'new-session', config: JSON.parse(row.targetConfigJson ?? '{}') };
  return ScheduleSchema.parse({
    scheduleId: row.scheduleId,
    spec: {
      name: row.name ?? undefined,
      prompt: row.prompt,
      cadence,
      target,
      maxRuns: row.maxRuns ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
    },
    status: row.status,
    completedReason: row.completedReason ?? undefined,
    nextRunAt: row.nextRunAt ?? undefined,
    lastRunAt: row.lastRunAt ?? undefined,
    runCount: row.runCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toRunRow(run: ScheduleRun): typeof scheduleRuns.$inferInsert {
  return {
    runId: run.runId,
    scheduleId: run.scheduleId,
    status: run.status,
    trigger: run.trigger,
    sessionId: run.sessionId ?? null,
    error: run.error ?? null,
    summary: run.summary ?? null,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
  };
}

function toRun(row: ScheduleRunRow): ScheduleRun {
  return ScheduleRunSchema.parse({
    runId: row.runId,
    scheduleId: row.scheduleId,
    status: row.status,
    trigger: row.trigger,
    sessionId: row.sessionId ?? undefined,
    error: row.error ?? undefined,
    summary: row.summary ?? undefined,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
  });
}
