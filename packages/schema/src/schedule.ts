import { z } from 'zod';
import {
  AgentKindSchema,
  ScheduleIdSchema,
  ScheduleRunIdSchema,
  SessionIdSchema,
  TimestampSchema,
} from './common';

/**
 * Schedules: cron/interval recurring automations that fire a prompt at an agent. The daemon's
 * ScheduleService owns a central tick that resolves each schedule's `nextRunAt` and dispatches a
 * run; the record here is the persisted, client-facing identity. See docs/ARCHITECTURE.md and the
 * engine's automation/ module.
 */

/** How often a schedule fires. `interval` preserves phase; `cron` uses croner with an IANA tz. */
export const ScheduleCadenceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cron'),
    /** Standard 5-field cron expression, validated by croner. */
    expression: z.string().min(1),
    /** IANA time zone (e.g. `Asia/Shanghai`); daemon-local when absent. */
    timezone: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('interval'),
    /** Fixed interval in ms; floored at one minute to bound tick load. */
    everyMs: z.number().int().min(60000),
  }),
]);
export type ScheduleCadence = z.infer<typeof ScheduleCadenceSchema>;

/** Config for a schedule that mints a fresh session on every run. */
export const ScheduleNewSessionConfigSchema = z.object({
  kind: AgentKindSchema,
  cwd: z.string().min(1),
  model: z.string().min(1).optional(),
});
export type ScheduleNewSessionConfig = z.infer<typeof ScheduleNewSessionConfigSchema>;

/**
 * Where a run's prompt goes. `session` injects into an existing session (resumed if cold, failed if
 * busy); `new-session` mints a fresh hidden session per run. Target is immutable after creation —
 * retarget by deleting and recreating.
 */
export const ScheduleTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sessionId: SessionIdSchema }),
  z.object({ type: z.literal('new-session'), config: ScheduleNewSessionConfigSchema }),
]);
export type ScheduleTarget = z.infer<typeof ScheduleTargetSchema>;

/** Client-authored creation payload. */
export const ScheduleSpecSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1),
  cadence: ScheduleCadenceSchema,
  target: ScheduleTargetSchema,
  /** Auto-complete the schedule after this many cadence runs (manual/catch-up excluded). */
  maxRuns: z.number().int().min(1).optional(),
  /** Auto-complete the schedule at this timestamp. */
  expiresAt: TimestampSchema.optional(),
});
export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>;

/** Mutable fields on update; `target` is immutable (delete + recreate to retarget). */
export const ScheduleUpdateSchema = ScheduleSpecSchema.omit({ target: true }).partial();
export type ScheduleUpdate = z.infer<typeof ScheduleUpdateSchema>;

export const ScheduleStatusSchema = z.enum(['active', 'paused', 'completed']);
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;

/** Why a schedule reached `completed`. */
export const ScheduleCompletedReasonSchema = z.enum(['maxRuns', 'expired', 'targetGone']);
export type ScheduleCompletedReason = z.infer<typeof ScheduleCompletedReasonSchema>;

/** The persisted identity of a schedule. */
export const ScheduleSchema = z.object({
  scheduleId: ScheduleIdSchema,
  spec: ScheduleSpecSchema,
  status: ScheduleStatusSchema,
  completedReason: ScheduleCompletedReasonSchema.optional(),
  /** Next cadence fire time; absent while paused or completed. */
  nextRunAt: TimestampSchema.optional(),
  lastRunAt: TimestampSchema.optional(),
  /** Count of cadence runs only — manual and catch-up runs are excluded from maxRuns. */
  runCount: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const ScheduleRunStatusSchema = z.enum(['running', 'succeeded', 'failed', 'skipped']);
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>;

/** `cadence` = a normal tick fire; `manual` = run-once; `catch-up` = a missed fire replayed within grace. */
export const ScheduleRunTriggerSchema = z.enum(['cadence', 'manual', 'catch-up']);
export type ScheduleRunTrigger = z.infer<typeof ScheduleRunTriggerSchema>;

/** One firing of a schedule. */
export const ScheduleRunSchema = z.object({
  runId: ScheduleRunIdSchema,
  scheduleId: ScheduleIdSchema,
  status: ScheduleRunStatusSchema,
  trigger: ScheduleRunTriggerSchema,
  /** The session the prompt ran in (target session, or the freshly minted one), once known. */
  sessionId: SessionIdSchema.optional(),
  /** Failure reason, e.g. `session busy`, `waiting for permission: Edit`, `target session gone`. */
  error: z.string().optional(),
  /** Final assistant text of the run, truncated (~2000 chars). */
  summary: z.string().optional(),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;
