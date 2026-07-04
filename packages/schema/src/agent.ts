import { z } from 'zod';
import {
  AgentHistoryIdSchema,
  AgentKindSchema,
  MessageIdSchema,
  SessionIdSchema,
  TimestampSchema,
} from './common';
import { ContentBlockSchema } from './content';
import { PermissionOutcomeSchema, PermissionRequestSchema } from './permission';
import { PlanSchema } from './plan';
import {
  McpServerSchema,
  SessionModeIdSchema,
  SessionStatusSchema,
  StopReasonSchema,
} from './session';
import { ToolCallSchema } from './tool-call';
import { TokenUsageSchema } from './usage';

/**
 * Agent data-plane contract. The abstraction layer normalizes each vendor's native agent events into the
 * `AgentEvent` union, tailored to the four supported agents (claude-code / codex / opencode / pi) and the
 * front-end. The flow is always "change the schema first, then the implementation"
 * (docs/ARCHITECTURE.md#core-principles).
 */

// ── Upstream: client → host → agent ──────────────────────────────────────────

/** Parameters required to start an agent session. */
export const StartOptionsSchema = z.object({
  kind: AgentKindSchema,
  /** Working directory (the root of the repository the agent operates on). */
  cwd: z.string().min(1),
  /** Model id override (vendor-specific); defaults to the adapter's configured default. */
  model: z.string().optional(),
  /** Initial session mode (e.g. plan / accept-edits), if the agent advertises modes. */
  modeId: SessionModeIdSchema.optional(),
  /** MCP servers the agent should connect to. */
  mcpServers: z.array(McpServerSchema).optional(),
  /** Extra directories the agent may access beyond `cwd`. */
  additionalDirectories: z.array(z.string()).optional(),
  /** Free-form adapter-specific parameters. */
  config: z.record(z.string(), z.unknown()).optional(),
});
export type StartOptions = z.infer<typeof StartOptionsSchema>;

/** Reasoning-effort levels. low–xhigh switch live via the adapters' settings channel; `max` cannot
 * (Claude only accepts it at process startup), so adapters honor it by restarting the underlying
 * process with the new effort and resuming the conversation in place under the same session.
 * `ultracode` is claude-code's xhigh-plus-standing-orchestration mode — modeled as a level because
 * that's how Claude's own effort menu presents it; it switches live like the plain levels. */
export const EffortLevelSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

/** Input sent up to the agent, normalized into discrete actions. */
export const AgentInputSchema = z.discriminatedUnion('type', [
  /** A user prompt as one or more content blocks (text / image / resource …). */
  z.object({ type: z.literal('prompt'), content: z.array(ContentBlockSchema) }),
  /** Cancel the in-flight turn (ACP session/cancel). */
  z.object({ type: z.literal('cancel') }),
  /** Switch the active session mode. */
  z.object({ type: z.literal('set-mode'), modeId: SessionModeIdSchema }),
  /** Switch the model for the session, going forward (vendor-specific id). Only adapters that
   * support changing the model on an already-running session accept this; others reject it. */
  z.object({ type: z.literal('set-model'), model: z.string().min(1) }),
  /** Switch the reasoning-effort level for the session, going forward. Same acceptance rule as
   * `set-model`: only adapters that can rebind effort on a live session accept this. */
  z.object({ type: z.literal('set-effort'), effort: EffortLevelSchema }),
  /** The user's decision for a pending permission-request (correlated by requestId). */
  z.object({
    type: z.literal('permission-response'),
    requestId: z.string().min(1),
    outcome: PermissionOutcomeSchema,
  }),
]);
export type AgentInput = z.infer<typeof AgentInputSchema>;

// ── Downstream: agent → abstraction layer (normalized) → client ──────────────

/**
 * Normalized agent event: the single downstream vocabulary every adapter emits and the front-end folds
 * into a conversation. The `permission-request` variant expects a matching reply via `AgentInput`,
 * correlated by `requestId`.
 */
export const AgentEventSchema = z.discriminatedUnion('type', [
  // ── User message: a complete, atomic message (not streamed) ──
  z.object({
    type: z.literal('user-message'),
    // Identity / dedup only — a user message is whole, so this never drives grouping.
    messageId: MessageIdSchema.optional(),
    // The full message, same shape as `AgentInput.prompt`'s content.
    content: z.array(ContentBlockSchema),
  }),

  // ── Agent output: streaming chunks, bucketed and concatenated by messageId ──
  z.object({
    type: z.literal('agent-message-chunk'),
    // Required: the grouping authority (chunks with the same id form one bubble).
    messageId: MessageIdSchema,
    content: ContentBlockSchema,
  }),
  z.object({
    type: z.literal('agent-thought-chunk'),
    // Required: the grouping authority (must differ from the matching message's id).
    messageId: MessageIdSchema,
    content: ContentBlockSchema,
  }),

  // ── Tools: one event per state change, each carrying the full current ToolCall snapshot ──
  z.object({ type: z.literal('tool-call'), toolCall: ToolCallSchema }),

  // ── Planning / meta ──
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  z.object({ type: z.literal('current-mode-update'), currentModeId: SessionModeIdSchema }),

  // ── Lifecycle ──
  z.object({ type: z.literal('status'), status: SessionStatusSchema }),
  /** The provider-local native id of the live run, once the adapter learns it. Lets the host bind
   * the Link Code session to provider history for later resume; adapters without history support
   * never emit it. */
  z.object({ type: z.literal('session-ref'), historyId: AgentHistoryIdSchema }),
  z.object({ type: z.literal('token-usage'), usage: TokenUsageSchema }),
  z.object({ type: z.literal('stop'), stopReason: StopReasonSchema }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
    recoverable: z.boolean().default(true),
  }),

  // ── Agent → client request (awaits a reply via AgentInput, correlated by requestId) ──
  PermissionRequestSchema.extend({
    type: z.literal('permission-request'),
    requestId: z.string().min(1),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Event with an envelope (session + timing), for cross-endpoint persistence and ordering. */
export const AgentEventEnvelopeSchema = z.object({
  sessionId: SessionIdSchema,
  ts: TimestampSchema,
  event: AgentEventSchema,
});
export type AgentEventEnvelope = z.infer<typeof AgentEventEnvelopeSchema>;
