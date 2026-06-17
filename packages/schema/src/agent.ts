import { z } from 'zod';
import { ClientRequestSchema, ClientResponseSchema } from './client-rpc';
import { AgentKindSchema, MessageIdSchema, SessionIdSchema, TimestampSchema } from './common';
import { ContentBlockSchema } from './content';
import { PermissionOptionSchema, PermissionOutcomeSchema } from './permission';
import { PlanSchema } from './plan';
import {
  AvailableCommandSchema,
  McpServerSchema,
  SessionConfigOptionSchema,
  SessionModeIdSchema,
  SessionStatusSchema,
  StopReasonSchema,
} from './session';
import { ToolCallSchema, ToolCallUpdateSchema } from './tool-call';
import { TokenUsageSchema } from './usage';

/**
 * Agent data-plane contract. The abstraction layer normalizes each vendor's native agent events into
 * `AgentEvent`, modeled on ACP's `session/update` vocabulary (PLAN §4.3). The flow is always
 * "change the schema first, then the implementation" (PLAN §2.1).
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

/** Input sent up to the agent, normalized into discrete actions. */
export const AgentInputSchema = z.discriminatedUnion('type', [
  /** A user prompt as one or more content blocks (text / image / resource …). */
  z.object({ type: z.literal('prompt'), content: z.array(ContentBlockSchema) }),
  /** Cancel the in-flight turn (ACP session/cancel). */
  z.object({ type: z.literal('cancel') }),
  /** Switch the active session mode. */
  z.object({ type: z.literal('set-mode'), modeId: SessionModeIdSchema }),
  /** The user's decision for a pending permission-request (correlated by requestId). */
  z.object({
    type: z.literal('permission-response'),
    requestId: z.string().min(1),
    outcome: PermissionOutcomeSchema,
  }),
  /** Response to a pending client-request (fs/terminal RPC), correlated by requestId. */
  z.object({
    type: z.literal('client-response'),
    requestId: z.string().min(1),
    response: ClientResponseSchema,
  }),
]);
export type AgentInput = z.infer<typeof AgentInputSchema>;

// ── Downstream: agent → abstraction layer (normalized) → client ──────────────

/**
 * Normalized agent event. Mirrors ACP's `session/update` variants plus the lifecycle / RPC signals Link
 * Code needs. Note: the `client-request` (fs/terminal) and `permission-request` variants expect a matching
 * reply via `AgentInput`, correlated by `requestId`.
 */
export const AgentEventSchema = z.discriminatedUnion('type', [
  // ── Streaming content ──
  z.object({
    type: z.literal('user-message-chunk'),
    messageId: MessageIdSchema.optional(),
    content: ContentBlockSchema,
  }),
  z.object({
    type: z.literal('agent-message-chunk'),
    messageId: MessageIdSchema.optional(),
    content: ContentBlockSchema,
  }),
  z.object({
    type: z.literal('agent-thought-chunk'),
    messageId: MessageIdSchema.optional(),
    content: ContentBlockSchema,
  }),

  // ── Tools ──
  z.object({ type: z.literal('tool-call'), toolCall: ToolCallSchema }),
  z.object({ type: z.literal('tool-call-update'), update: ToolCallUpdateSchema }),

  // ── Planning / meta ──
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  z.object({
    type: z.literal('available-commands-update'),
    availableCommands: z.array(AvailableCommandSchema),
  }),
  z.object({ type: z.literal('current-mode-update'), currentModeId: SessionModeIdSchema }),
  z.object({
    type: z.literal('config-option-update'),
    configOptions: z.array(SessionConfigOptionSchema),
  }),

  // ── Lifecycle ──
  z.object({ type: z.literal('status'), status: SessionStatusSchema }),
  z.object({ type: z.literal('token-usage'), usage: TokenUsageSchema }),
  z.object({ type: z.literal('stop'), stopReason: StopReasonSchema }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
    recoverable: z.boolean().default(true),
  }),

  // ── Agent → client requests (await a reply via AgentInput, correlated by requestId) ──
  z.object({
    type: z.literal('permission-request'),
    requestId: z.string().min(1),
    toolCall: ToolCallUpdateSchema,
    options: z.array(PermissionOptionSchema),
  }),
  z.object({
    type: z.literal('client-request'),
    requestId: z.string().min(1),
    request: ClientRequestSchema,
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
