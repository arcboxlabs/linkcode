import { z } from 'zod';

/**
 * Common base types. 🔧 Proposed starting point — not a final contract.
 * The workflow is always "change the schema first, then the implementation" (PLAN §2.1).
 */

/** Session ID: the lifecycle identifier of a single agent session. */
export const SessionIdSchema = z.string().min(1).brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionIdSchema>;

/** Message / event ID: used for cross-endpoint deduplication and correlation. */
export const MessageIdSchema = z.string().min(1).brand<'MessageId'>();
export type MessageId = z.infer<typeof MessageIdSchema>;

/** Epoch timestamp in milliseconds. */
export const TimestampSchema = z.number().int().nonnegative();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Supported agent kinds. ✅ Four vendors (CC naming ❓, see PLAN §4.2). */
export const AgentKindSchema = z.enum(['claude-code', 'codex', 'opencode', 'pi']);
export type AgentKind = z.infer<typeof AgentKindSchema>;
