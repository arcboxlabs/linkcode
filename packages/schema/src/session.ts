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

/**
 * Approval policies — the permission/safety axis: when the agent asks before acting. Orthogonal to
 * the workflow SessionMode axis above (see packages/ui approval-policy.ts for the rationale).
 * Adapters advertise their own policy list and translate ids per agent (claude-code → its
 * permission modes, codex → approval_policy/sandbox).
 */
export const ApprovalPolicyIdSchema = z.string().min(1);
export type ApprovalPolicyId = z.infer<typeof ApprovalPolicyIdSchema>;

export const ApprovalPolicySchema = z.object({
  policyId: ApprovalPolicyIdSchema,
  name: z.string(),
  description: z.string().optional(),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

/** Full policy state, emitted whole (at session start and after every switch) so clients never
 * have to join a separate list request against a current-id event. Empty `availablePolicies`
 * means the agent has no switchable policy axis and clients hide the selector. */
export const ApprovalPolicyStateSchema = z.object({
  availablePolicies: z.array(ApprovalPolicySchema),
  currentPolicyId: ApprovalPolicyIdSchema,
});
export type ApprovalPolicyState = z.infer<typeof ApprovalPolicyStateSchema>;

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
