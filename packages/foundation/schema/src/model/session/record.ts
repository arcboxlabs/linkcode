import { z } from 'zod';
import { EffortLevelSchema } from '../agent/input';
import { AgentHistoryCapabilitiesSchema } from '../history';
import { ImPlatformSchema } from '../im';
import {
  AgentHistoryIdSchema,
  AgentKindSchema,
  SessionIdSchema,
  TimestampSchema,
} from '../primitives';
import { ApprovalPolicyIdSchema } from './control';
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

/**
 * One live start/resume of a session. Providers usually mint a new native id per resume, so a
 * session accumulates runs; `historyId` is backfilled once the adapter reports it (session-ref).
 *
 * Everything below `historyId` is what the thread is *set to* — the choices it launched with plus
 * every pick accepted since — and a relaunch replays them so the thread keeps them when the
 * configured default moves. What an adapter resolved for itself is deliberately absent: recording
 * that would pin every thread to its first launch and cut it off from the agent's default for good.
 */
export const SessionRunSchema = z.object({
  historyId: AgentHistoryIdSchema.optional(),
  /** The account this run resolved to. Credentials and base URL are injected once at spawn, so the
   * account is fixed for the run's lifetime and a later rebind does not move it. */
  accountId: z.string().min(1).optional(),
  /** Recorded with the account because the two are one choice. */
  model: z.string().min(1).optional(),
  /** Both axes live on the adapter a relaunch destroys, so they are replayed from here or lost. */
  effort: EffortLevelSchema.optional(),
  approvalPolicyId: ApprovalPolicyIdSchema.optional(),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type SessionRun = z.infer<typeof SessionRunSchema>;

/** The persisted identity of a session: what survives daemon restarts and is listed to clients. */
export const SessionRecordSchema = z.object({
  sessionId: SessionIdSchema,
  kind: AgentKindSchema,
  cwd: z.string(),
  /** Provider title when available; otherwise derived from the first prompt. */
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
  /** Latest run's account — what the session is talking to now. Picking a model from another
   * account relaunches the session on it, which starts a new run. */
  accountId: z.string().min(1).optional(),
  /** Provider-history operations supported by this session's adapter/runtime. */
  historyCapabilities: AgentHistoryCapabilitiesSchema.optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
