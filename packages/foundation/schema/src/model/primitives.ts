import { z } from 'zod';

/** Common base types. The zod schema is the only data contract: always "change the schema first,
 * then the implementation" (docs/ARCHITECTURE.md#core-principles). */

/** Session ID: the lifecycle identifier of a single agent session. */
export const SessionIdSchema = z.string().min(1).brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionIdSchema>;

/** Workspace ID: the identifier of a registered directory (see workspace.ts). */
export const WorkspaceIdSchema = z.string().min(1).brand<'WorkspaceId'>();
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

/** Message / event ID: used for cross-endpoint deduplication and correlation. */
export const MessageIdSchema = z.string().min(1).brand<'MessageId'>();
export type MessageId = z.infer<typeof MessageIdSchema>;

/** Provider-local history id, e.g. a Claude Code session id or a future Codex thread id. */
export const AgentHistoryIdSchema = z.string().min(1).brand<'AgentHistoryId'>();
export type AgentHistoryId = z.infer<typeof AgentHistoryIdSchema>;

/** Schedule ID: the identifier of a recurring automation (see schedule.ts). */
export const ScheduleIdSchema = z.string().min(1).brand<'ScheduleId'>();
export type ScheduleId = z.infer<typeof ScheduleIdSchema>;

/** Schedule run ID: one firing of a schedule (see schedule.ts). */
export const ScheduleRunIdSchema = z.string().min(1).brand<'ScheduleRunId'>();
export type ScheduleRunId = z.infer<typeof ScheduleRunIdSchema>;

/** Loop ID: the identifier of an iterative worker+verifier loop (see loop.ts). */
export const LoopIdSchema = z.string().min(1).brand<'LoopId'>();
export type LoopId = z.infer<typeof LoopIdSchema>;

/** Turn ID: host-minted, durable identity of one conversation turn (see conversation.ts). */
export const TurnIdSchema = z.string().min(1).brand<'TurnId'>();
export type TurnId = z.infer<typeof TurnIdSchema>;

/** Prompt ID: identity of an immutable prompt record, shared by reference across forks. */
export const PromptIdSchema = z.string().min(1).brand<'PromptId'>();
export type PromptId = z.infer<typeof PromptIdSchema>;

/** Run ID: explicit identity of one live start/resume of a session (see session/record.ts). */
export const RunIdSchema = z.string().min(1).brand<'RunId'>();
export type RunId = z.infer<typeof RunIdSchema>;

/** Attachment ID: identity of an immutable prompt/session attachment. */
/** The charset is also a materialized filename segment — anything else is a path traversal. */
export const AttachmentIdSchema = z
  .string()
  .regex(/^[\w-]{1,128}$/)
  .brand<'AttachmentId'>();
export type AttachmentId = z.infer<typeof AttachmentIdSchema>;

/** Operation ID: client-minted idempotency key for conversation mutations (see conversation.ts). */
export const OperationIdSchema = z.string().min(1).brand<'OperationId'>();
export type OperationId = z.infer<typeof OperationIdSchema>;

/** Epoch timestamp in milliseconds. */
export const TimestampSchema = z.number().int().nonnegative();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Supported agent kinds — the vendors in docs/ARCHITECTURE.md#packages--repo-layout. */
export const AgentKindSchema = z.enum(['claude-code', 'codex', 'opencode', 'pi', 'grok-build']);
export type AgentKind = z.infer<typeof AgentKindSchema>;
