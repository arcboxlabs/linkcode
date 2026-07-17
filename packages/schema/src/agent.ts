import { z } from 'zod';
import {
  AgentHistoryIdSchema,
  AgentKindSchema,
  MessageIdSchema,
  SessionIdSchema,
  TimestampSchema,
} from './common';
import { ContentBlockSchema } from './content';
import { ImPlatformSchema } from './im';
import { PermissionOutcomeSchema, PermissionRequestSchema } from './permission';
import { PlanSchema } from './plan';
import { QuestionOutcomeSchema, QuestionRequestSchema } from './question';
import {
  ApprovalPolicyIdSchema,
  ApprovalPolicyStateSchema,
  McpServerSchema,
  SessionModeIdSchema,
  SessionStatusSchema,
  StopReasonSchema,
} from './session';
import { ToolCallSchema } from './tool-call';
import { TokenUsageSchema, UsageReportSchema } from './usage';

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
  /** The IM platform starting this session (attribution/audit); omitted by LinkCode clients. */
  createdVia: ImPlatformSchema.optional(),
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

/** A provider slash command the session can invoke, normalized across agents (claude-code
 * `SlashCommand`, opencode `Command`). `name` carries no leading slash. */
export const AgentCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** Hint for the command's arguments (e.g. "<file>"), when the provider supplies one. */
  argumentHint: z.string().optional(),
  /** Alternate names that invoke the same command (claude-code, e.g. `/cost` → `/usage`), no
   * leading slash. Input matching accepts them; menus display only the canonical `name`. */
  aliases: z.array(z.string().min(1)).optional(),
});
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

/** True when `name` invokes `command` — its canonical name or one of its provider aliases. */
export function agentCommandMatches(command: AgentCommand, name: string): boolean {
  return command.name === name || (command.aliases?.includes(name) ?? false);
}

/** A model a live session accepts via `AgentInput.set-model`, advertised by adapters whose model
 * set is install-dependent (opencode: whatever providers the user's local install has connected)
 * rather than a fixed vendor list. `id` is the exact value to send back on `set-model`. */
export const AgentModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type AgentModelOption = z.infer<typeof AgentModelOptionSchema>;

/** Input features a live adapter session accepts. Kept separate from command catalogs: catalogs
 * change provider-side, while these booleans describe the adapter's stable input surface. */
export const AgentCapabilitiesSchema = z.object({
  slashCommands: z.boolean(),
  shellCommand: z.boolean(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

/** Input sent up to the agent, normalized into discrete actions. */
export const AgentInputSchema = z.discriminatedUnion('type', [
  /** A user prompt as one or more content blocks (text / image / resource …). */
  z.object({ type: z.literal('prompt'), content: z.array(ContentBlockSchema) }),
  /** Invoke a provider slash command by name (advertised via `available-commands-update`). Only
   * adapters that emit a command catalog accept this; others reject it. */
  z.object({
    type: z.literal('command'),
    name: z.string().min(1),
    /** The raw argument text the user typed after the command name, if any. */
    arguments: z.string().optional(),
  }),
  /** Run a raw shell command in the session's working directory, outside the model loop (the
   * user's `$` input). Only adapters whose provider has a shell passthrough accept this. */
  z.object({ type: z.literal('shell-command'), command: z.string().min(1) }),
  /** Cancel the in-flight turn (ACP session/cancel). */
  z.object({ type: z.literal('cancel') }),
  /** Switch the active session mode. */
  z.object({ type: z.literal('set-mode'), modeId: SessionModeIdSchema }),
  /** Switch the approval policy (the permission/safety axis, orthogonal to `set-mode`). Only
   * adapters that advertise policies via `approval-policy-update` accept this; others reject it. */
  z.object({ type: z.literal('set-approval-policy'), policyId: ApprovalPolicyIdSchema }),
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
  /** The user's answers for a pending question-request (correlated by requestId). */
  z.object({
    type: z.literal('question-response'),
    requestId: z.string().min(1),
    outcome: QuestionOutcomeSchema,
  }),
]);
export type AgentInput = z.infer<typeof AgentInputSchema>;

/** Who settled an interactive request: an explicit client reply, or session lifecycle teardown. */
export const PromptResolutionSourceSchema = z.enum(['user', 'session']);
export type PromptResolutionSource = z.infer<typeof PromptResolutionSourceSchema>;
export const PromptResponseStatusSchema = z.enum(['open', 'responding']);
export type PromptResponseStatus = z.infer<typeof PromptResponseStatusSchema>;

// ── Downstream: agent → abstraction layer (normalized) → client ──────────────

/**
 * Normalized agent event: the single downstream vocabulary every adapter emits and the front-end folds
 * into a conversation. Permission/question requests expect a matching reply via `AgentInput`; the
 * host confirms settlement with the corresponding `*-resolved` event, correlated by `requestId`.
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
    // Set on subagent narration: the `task`-kind tool call that spawned the subagent.
    parentToolCallId: z.string().min(1).optional(),
    content: ContentBlockSchema,
  }),
  z.object({
    type: z.literal('agent-thought-chunk'),
    // Required: the grouping authority (must differ from the matching message's id).
    messageId: MessageIdSchema,
    parentToolCallId: z.string().min(1).optional(),
    content: ContentBlockSchema,
  }),

  // ── Tools: one event per state change, each carrying the full current ToolCall snapshot ──
  z.object({ type: z.literal('tool-call'), toolCall: ToolCallSchema }),

  // ── Context compaction: the agent summarized earlier turns in place to free context window ──
  /** Emitted at the compaction boundary with whatever is known at that moment, and again once the
   * swapped-in summary text is learned (it arrives on a later frame). Consumers merge events by
   * `compactionId` — the provider's own boundary id — so partial emits, live re-emits, and history
   * replay of the same compaction all converge into one timeline marker. */
  z.object({
    type: z.literal('compaction'),
    compactionId: z.string().min(1),
    trigger: z.enum(['manual', 'auto']).optional(),
    /** Context tokens before / after the compaction, when the provider reports them. */
    preTokens: z.number().int().nonnegative().optional(),
    postTokens: z.number().int().nonnegative().optional(),
    /** The summary text the provider swapped in for the compacted turns. */
    summary: z.string().optional(),
  }),

  // ── Planning / meta ──
  z.object({ type: z.literal('plan'), plan: PlanSchema }),
  z.object({ type: z.literal('current-mode-update'), currentModeId: SessionModeIdSchema }),
  /** Full approval-policy state (advertised list + current), at session start and after switches. */
  z.object({ type: z.literal('approval-policy-update'), state: ApprovalPolicyStateSchema }),
  /** The model the session is actually running on, so clients reflect the true value instead of a
   * placeholder. Only the current id travels here — the available list is either the static UI
   * catalog (claude-code/codex) or the adapter-advertised `available-models-update` catalog.
   * Emitted once the adapter learns the served model (claude-code's init/assistant frames report
   * it even when no model was requested) and on every switch. Adapters that can't observe their
   * model never emit it. */
  z.object({ type: z.literal('model-update'), model: z.string().min(1) }),
  /** The reasoning-effort level the session is actually running at. Same rationale as `model-update`.
   * Emitted on every switch and, for adapters that can observe the resolved default (claude-code via
   * a Stop hook's `effort.level`), once the default is learned. `undefined`/never-emitted keeps the
   * client showing a placeholder rather than a guessed value. */
  z.object({ type: z.literal('effort-update'), effort: EffortLevelSchema }),
  /** Stable input capabilities for this live adapter session. Emitted at adapter start and replayed
   * on attach so clients never infer support from the agent kind. */
  z.object({
    type: z.literal('capabilities-update'),
    capabilities: AgentCapabilitiesSchema,
  }),
  /** The slash-command catalog the session accepts via `AgentInput.command` — emitted once the
   * adapter learns it and again on every provider-side change, full-replace semantics (consumers
   * swap their cached list wholesale). */
  z.object({ type: z.literal('available-commands-update'), commands: z.array(AgentCommandSchema) }),
  /** The model catalog the session accepts via `AgentInput.set-model` — same full-replace contract
   * as the command catalog. Only adapters whose model set is install-dependent emit it (opencode);
   * agents with a curated static catalog (claude-code/codex) never do, and clients fall back to
   * their static tables. */
  z.object({ type: z.literal('available-models-update'), models: z.array(AgentModelOptionSchema) }),

  // ── Lifecycle ──
  z.object({ type: z.literal('status'), status: SessionStatusSchema }),
  /** The provider-local native id of the live run, once the adapter learns it. Lets the host bind
   * the Link Code session to provider history for later resume; adapters without history support
   * never emit it. */
  z.object({ type: z.literal('session-ref'), historyId: AgentHistoryIdSchema }),
  z.object({ type: z.literal('token-usage'), usage: TokenUsageSchema }),
  /** Structured usage snapshot produced by a provider usage command (claude-code `/usage`, alias
   * `/cost`). The invocation is intercepted adapter-side — it produces no transcript text and no
   * turn; this event is the whole reply, and the trigger a client uses to present usage. */
  z.object({ type: z.literal('usage-report'), report: UsageReportSchema }),
  z.object({ type: z.literal('stop'), stopReason: StopReasonSchema }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
    recoverable: z.boolean().default(true),
  }),

  // ── Agent → client requests (await a reply via AgentInput, correlated by requestId) ──
  PermissionRequestSchema.extend({
    type: z.literal('permission-request'),
    requestId: z.string().min(1),
  }),
  QuestionRequestSchema.extend({
    type: z.literal('question-request'),
    requestId: z.string().min(1),
  }),
  z.object({
    type: z.literal('prompt-response-status'),
    requestId: z.string().min(1),
    status: PromptResponseStatusSchema,
  }),
  z.object({
    type: z.literal('permission-resolved'),
    requestId: z.string().min(1),
    outcome: PermissionOutcomeSchema,
    source: PromptResolutionSourceSchema,
  }),
  z.object({
    type: z.literal('question-resolved'),
    requestId: z.string().min(1),
    outcome: QuestionOutcomeSchema,
    source: PromptResolutionSourceSchema,
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
