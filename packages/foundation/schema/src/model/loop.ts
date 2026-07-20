import { z } from 'zod';
import { AgentKindSchema, LoopIdSchema, SessionIdSchema, TimestampSchema } from './primitives';

/**
 * Loops: an iterate-until-verified automation. The daemon's LoopService runs a fresh worker session
 * per iteration, then verifies the result with shell checks and/or a structured verifier agent,
 * repeating (with the previous failure fed back into the next prompt) until verification passes or a
 * bound is hit. Unlike schedules, a loop is a single bounded job — a daemon restart stops it rather
 * than resuming. See docs/ARCHITECTURE.md and the engine's automation/ module.
 */

/** An optional structured verifier: a second agent that judges whether the goal is met. */
export const LoopVerifierSchema = z.object({
  /** Agent kind for the verifier; falls back to the worker's kind when absent. */
  kind: AgentKindSchema.optional(),
  model: z.string().min(1).optional(),
  /** Instruction describing what "done" means; the verifier answers with a pass/fail verdict. */
  prompt: z.string().min(1),
});
export type LoopVerifier = z.infer<typeof LoopVerifierSchema>;

/**
 * Client-authored loop definition. At least one verification mechanism is required (a non-empty
 * `verifyChecks` or a `verifier`) — a loop with no way to judge success would run to its bound every
 * time.
 */
export const LoopSpecSchema = z
  .object({
    name: z.string().min(1).optional(),
    /** Worker agent kind. */
    kind: AgentKindSchema,
    cwd: z.string().min(1),
    model: z.string().min(1).optional(),
    /** The goal handed to each iteration's fresh worker session. */
    prompt: z.string().min(1),
    /** Shell commands run after each iteration; all must exit 0 to count as a passing check gate. */
    verifyChecks: z.array(z.string().min(1)).default([]),
    /** Optional agent verifier layered on top of (or instead of) the shell checks. */
    verifier: LoopVerifierSchema.optional(),
    /** Hard cap on iterations. */
    maxIterations: z.number().int().min(1).max(100).default(10),
    /** Optional hard wall-clock budget, enforced during turns, checks, and iteration sleeps. */
    maxTimeMs: z.number().int().min(1000).optional(),
    /** Pause between iterations, in ms. */
    sleepMs: z.number().int().nonnegative().default(0),
    /** Per-turn timeout for the worker/verifier sessions. */
    turnTimeoutMs: z.number().int().min(1000).optional(),
  })
  .refine((spec) => spec.verifyChecks.length > 0 || spec.verifier != null, {
    message: 'a loop needs at least one verification: verifyChecks or a verifier',
    path: ['verifyChecks'],
  });
export type LoopSpec = z.infer<typeof LoopSpecSchema>;

export const LoopStatusSchema = z.enum(['running', 'succeeded', 'failed', 'stopped']);
export type LoopStatus = z.infer<typeof LoopStatusSchema>;

/** The persisted identity of a loop. */
export const LoopRecordSchema = z.object({
  loopId: LoopIdSchema,
  spec: LoopSpecSchema,
  status: LoopStatusSchema,
  /** Iterations completed so far. */
  iterationCount: z.number().int().nonnegative(),
  /** Why the loop failed/stopped, e.g. `max iterations reached`, `time budget exceeded`. */
  error: z.string().optional(),
  /** Final worker text of the winning iteration, truncated (~2000 chars). */
  summary: z.string().optional(),
  startedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type LoopRecord = z.infer<typeof LoopRecordSchema>;

/** One shell verify-check's outcome within an iteration. */
export const LoopCheckResultSchema = z.object({
  command: z.string().min(1),
  /** Process exit code; a timeout/kill surfaces as a non-zero code with `timedOut` set. */
  exitCode: z.number().int(),
  timedOut: z.boolean().optional(),
  /** Tail of combined stdout+stderr, truncated (~4 KB). */
  outputTail: z.string(),
});
export type LoopCheckResult = z.infer<typeof LoopCheckResultSchema>;

/** The verifier agent's structured judgement. */
export const LoopVerdictSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
});
export type LoopVerdict = z.infer<typeof LoopVerdictSchema>;

export const LoopIterationStatusSchema = z.enum(['running', 'passed', 'failed']);
export type LoopIterationStatus = z.infer<typeof LoopIterationStatusSchema>;

/** One iteration of a loop: a worker turn plus its verification. */
export const LoopIterationSchema = z.object({
  loopId: LoopIdSchema,
  /** Zero-based iteration index, monotonically increasing within the loop. */
  index: z.number().int().nonnegative(),
  status: LoopIterationStatusSchema,
  /** The hidden session the worker ran in. */
  workerSessionId: SessionIdSchema.optional(),
  /** The hidden session the verifier ran in, when a verifier is configured. */
  verifierSessionId: SessionIdSchema.optional(),
  checks: z.array(LoopCheckResultSchema),
  verdict: LoopVerdictSchema.optional(),
  /** Iteration-level failure reason (turn error, permission stall, timeout). */
  error: z.string().optional(),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type LoopIteration = z.infer<typeof LoopIterationSchema>;

export const LoopLogLevelSchema = z.enum(['info', 'warn', 'error']);
export type LoopLogLevel = z.infer<typeof LoopLogLevelSchema>;

/** What emitted a log line, for grouping/coloring in the client log view. */
export const LoopLogSourceSchema = z.enum(['system', 'worker', 'verifier', 'check']);
export type LoopLogSource = z.infer<typeof LoopLogSourceSchema>;

/** A single line of a loop's live log. `seq` is monotonic per loop and drives client dedup/ordering. */
export const LoopLogEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: TimestampSchema,
  level: LoopLogLevelSchema,
  source: LoopLogSourceSchema,
  message: z.string(),
  /** Iteration index this line belongs to, when applicable. */
  iteration: z.number().int().nonnegative().optional(),
});
export type LoopLogEntry = z.infer<typeof LoopLogEntrySchema>;

/** A loop's full detail: the record, its iterations, and the ring-buffered log tail (`loop.inspect`). */
export const LoopInspectionSchema = z.object({
  loop: LoopRecordSchema,
  iterations: z.array(LoopIterationSchema),
  logs: z.array(LoopLogEntrySchema),
});
export type LoopInspection = z.infer<typeof LoopInspectionSchema>;
