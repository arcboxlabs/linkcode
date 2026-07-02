import { z } from 'zod';
import { AgentHistoryIdSchema, AgentKindSchema, SessionIdSchema, TimestampSchema } from './common';

/** Session modes (e.g. plan / accept-edits) the agent advertises and the user can switch between. */
export const SessionModeIdSchema = z.string().min(1);
export type SessionModeId = z.infer<typeof SessionModeIdSchema>;

export const SessionModeSchema = z.object({
  modeId: SessionModeIdSchema,
  name: z.string(),
  description: z.string().optional(),
});
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionModeStateSchema = z.object({
  availableModes: z.array(SessionModeSchema),
  currentModeId: SessionModeIdSchema,
});
export type SessionModeState = z.infer<typeof SessionModeStateSchema>;

/** Why a prompt turn ended. */
export const StopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

/** Link Code's own coarse lifecycle state for a session. */
export const SessionStatusSchema = z.enum([
  'starting',
  'idle',
  'running',
  'awaiting-input',
  'stopped',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** An MCP server the agent should connect to (passed at session start). */
export const McpServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);
export type McpServer = z.infer<typeof McpServerSchema>;

/** How a persisted session came to exist in Link Code. */
export const SessionOriginSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('created') }),
  z.object({
    type: z.literal('imported'),
    /** The provider-local history session this record was imported from. */
    historyId: AgentHistoryIdSchema,
    importedAt: TimestampSchema,
  }),
]);
export type SessionOrigin = z.infer<typeof SessionOriginSchema>;

/**
 * One live start/resume of a session. Providers usually mint a new native id per resume, so a
 * session accumulates runs; `historyId` is backfilled once the adapter reports it (session-ref).
 */
export const SessionRunSchema = z.object({
  historyId: AgentHistoryIdSchema.optional(),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type SessionRun = z.infer<typeof SessionRunSchema>;

/** The persisted identity of a session: what survives daemon restarts and is listed to clients. */
export const SessionRecordSchema = z.object({
  sessionId: SessionIdSchema,
  kind: AgentKindSchema,
  cwd: z.string(),
  /** Derived from the first prompt, or user-renamed later. */
  title: z.string().optional(),
  origin: SessionOriginSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  runs: z.array(SessionRunSchema),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

/** Summary of a session for session.list: persisted identity + live status. */
export const SessionInfoSchema = z.object({
  sessionId: SessionIdSchema,
  kind: AgentKindSchema,
  cwd: z.string(),
  status: SessionStatusSchema,
  createdAt: z.number().int().nonnegative(),
  /** Last persisted activity (run start/stop, first prompt, provider linkage) — the recency ordering key. */
  updatedAt: TimestampSchema,
  title: z.string().optional(),
  origin: SessionOriginSchema.optional(),
  /** Latest run's provider-local history id — the transcript to read this session's past from. */
  historyId: AgentHistoryIdSchema.optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
