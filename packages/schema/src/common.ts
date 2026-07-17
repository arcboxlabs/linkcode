import { z } from 'zod';

/**
 * Common base types. The zod schema is the only data contract: the workflow is always
 * "change the schema first, then the implementation" (docs/ARCHITECTURE.md#core-principles).
 */

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

/** Epoch timestamp in milliseconds. */
export const TimestampSchema = z.number().int().nonnegative();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Supported agent kinds — the vendors in docs/ARCHITECTURE.md#packages--repo-layout. */
export const AgentKindSchema = z.enum(['claude-code', 'codex', 'opencode', 'pi', 'grok-build']);
export type AgentKind = z.infer<typeof AgentKindSchema>;
