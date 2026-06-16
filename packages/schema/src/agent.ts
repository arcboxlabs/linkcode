import { z } from 'zod';
import { AgentKindSchema, MessageIdSchema, SessionIdSchema, TimestampSchema } from './common';

/**
 * Agent data-plane contract: the abstraction layer normalizes each vendor's native agent events into this format (PLAN §4.3).
 * 🔧 Proposed starting point — fields will be adjusted once each vendor's SDK integration shape is confirmed.
 */

// ── Upstream: client → host → agent ──────────────────────────────────────────

/** Parameters required to start an agent session. */
export const StartOptionsSchema = z.object({
  kind: AgentKindSchema,
  /** Working directory (the root of the repository the agent operates on). */
  cwd: z.string().min(1),
  /** Free-form parameters passed to the adapter; exact shape pending SDK confirmation. */
  config: z.record(z.string(), z.unknown()).optional(),
});
export type StartOptions = z.infer<typeof StartOptionsSchema>;

/** User input sent to the agent, normalized into discrete actions. */
export const AgentInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user-message'), text: z.string() }),
  /** Authorization decision for a single tool call (PLAN §4.7 perm). */
  z.object({
    type: z.literal('tool-approval'),
    callId: z.string().min(1),
    decision: z.enum(['allow', 'deny', 'allow-always']),
  }),
  /** Interrupt the current generation. */
  z.object({ type: z.literal('interrupt') }),
]);
export type AgentInput = z.infer<typeof AgentInputSchema>;

// ── Downstream: agent → abstraction layer (normalized) → client ──────────────────────────────

/** Tool call (the agent wants to run a tool / command). */
export const ToolCallSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** Normalized agent event. */
export const AgentEventSchema = z.discriminatedUnion('type', [
  /** Assistant text delta (streaming). `done` marks whether this message has ended. */
  z.object({
    type: z.literal('assistant-delta'),
    messageId: MessageIdSchema,
    text: z.string(),
    done: z.boolean().default(false),
  }),
  z.object({ type: z.literal('tool-call'), call: ToolCallSchema }),
  z.object({
    type: z.literal('tool-result'),
    callId: z.string().min(1),
    ok: z.boolean(),
    output: z.unknown(),
  }),
  /** Session status change. */
  z.object({
    type: z.literal('status'),
    status: z.enum(['starting', 'idle', 'running', 'awaiting-input', 'stopped']),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    recoverable: z.boolean().default(true),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Event with an envelope (carrying session and timing info), for cross-endpoint persistence and ordering. */
export const AgentEventEnvelopeSchema = z.object({
  sessionId: SessionIdSchema,
  ts: TimestampSchema,
  event: AgentEventSchema,
});
export type AgentEventEnvelope = z.infer<typeof AgentEventEnvelopeSchema>;
