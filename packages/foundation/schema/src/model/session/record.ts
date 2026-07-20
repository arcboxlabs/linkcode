import { z } from 'zod';
import { ImPlatformSchema } from '../im';
import {
  AgentHistoryIdSchema,
  AgentKindSchema,
  SessionIdSchema,
  TimestampSchema,
} from '../primitives';
import { SessionStatusSchema } from './lifecycle';

/**
 * Set when an automation (a loop or schedule) created this session. Clients hide tagged sessions
 * from the Threads list; the owning automation's detail view links back to them. `id` is the
 * loop/schedule id — a plain string to avoid a cross-brand union on the record.
 */
export const SessionAutomationSchema = z.object({
  kind: z.enum(['loop', 'schedule']),
  id: z.string().min(1),
});
export type SessionAutomation = z.infer<typeof SessionAutomationSchema>;

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

/** One live start/resume of a session. Providers usually mint a new native id per resume, so a
 * session accumulates runs; `historyId` is backfilled once the adapter reports it (session-ref). */
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
  /** The IM platform this session was created from (attribution/audit); absent for LinkCode clients. */
  createdVia: ImPlatformSchema.optional(),
  /** Set when an automation created this session; clients hide tagged sessions from Threads. */
  automation: SessionAutomationSchema.optional(),
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
  createdAt: TimestampSchema,
  /** Last persisted activity (run start/stop, first prompt, provider linkage) — the recency ordering key. */
  updatedAt: TimestampSchema,
  title: z.string().optional(),
  origin: SessionOriginSchema.optional(),
  /** The IM platform this session was created from (attribution/audit); absent for LinkCode clients. */
  createdVia: ImPlatformSchema.optional(),
  /** Set when an automation created this session; clients hide tagged sessions from Threads. */
  automation: SessionAutomationSchema.optional(),
  /** Latest run's provider-local history id — the transcript to read this session's past from. */
  historyId: AgentHistoryIdSchema.optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
