import { z } from 'zod';
import { ContentBlockSchema } from '../content';
import { PermissionOutcomeSchema, PermissionRequestSchema } from '../permission';
import { PlanSchema } from '../plan';
import { McpPluginIdSchema, McpPluginServiceSchema, PluginWarningReasonSchema } from '../plugin';
import {
  AgentHistoryIdSchema,
  MessageIdSchema,
  SessionIdSchema,
  TimestampSchema,
} from '../primitives';
import { QuestionOutcomeSchema, QuestionRequestSchema } from '../question';
import { ApprovalPolicyStateSchema, SessionModeIdSchema } from '../session/control';
import { SessionStatusSchema, StopReasonSchema } from '../session/lifecycle';
import { ToolCallContentSchema, ToolCallSchema } from '../tool-call';
import { TokenUsageSchema, UsageReportSchema } from '../usage';
import {
  AgentCapabilitiesSchema,
  AgentCommandSchema,
  AgentModelOptionSchema,
  EffortLevelSchema,
} from './input';

/** Who settled an interactive request: an explicit client reply, or session lifecycle teardown. */
export const PromptResolutionSourceSchema = z.enum(['user', 'session']);
export type PromptResolutionSource = z.infer<typeof PromptResolutionSourceSchema>;
export const PromptResponseStatusSchema = z.enum(['open', 'responding']);
export type PromptResponseStatus = z.infer<typeof PromptResponseStatusSchema>;

/**
 * Normalized agent event: the single downstream vocabulary every adapter emits and the front-end folds
 * into a conversation. Permission/question requests expect a matching reply via `AgentInput`; the
 * host confirms settlement with the corresponding `*-resolved` event, correlated by `requestId`.
 */
export const AgentEventSchema = z.discriminatedUnion('type', [
  // User message: a complete, atomic message (not streamed).
  z.object({
    type: z.literal('user-message'),
    // Identity / dedup only — a user message is whole, so this never drives grouping.
    messageId: MessageIdSchema,
    // The full message, same shape as `AgentInput.prompt`'s content.
    content: z.array(ContentBlockSchema),
  }),

  // Agent output: whole snapshots replace by messageId; chunks append to the same identity.
  // Omitting whole-event content confirms/backfills identity without changing the current body.
  z.object({
    type: z.literal('agent-message'),
    messageId: MessageIdSchema,
    parentToolCallId: z.string().min(1).optional(),
    content: z.array(ContentBlockSchema).optional(),
  }),
  z.object({
    type: z.literal('agent-thought'),
    messageId: MessageIdSchema,
    parentToolCallId: z.string().min(1).optional(),
    content: z.array(ContentBlockSchema).optional(),
  }),
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

  // Tools: state patches carry a full snapshot; content chunks append one item without resending
  // the accumulated array. A later full snapshot remains authoritative and replaces by id.
  z.object({ type: z.literal('tool-call'), toolCall: ToolCallSchema }),
  z.object({
    type: z.literal('tool-call-content-chunk'),
    toolCallId: z.string().min(1),
    content: ToolCallContentSchema,
  }),

  /** Emitted at the compaction boundary and again once the swapped-in summary text is learned.
   * Consumers merge events by `compactionId` (the provider's own boundary id), so partial emits,
   * live re-emits, and history replay converge into one timeline marker. */
  z.object({
    type: z.literal('compaction'),
    compactionId: z.string().min(1),
    /** Absent means completed — providers that only report the finished boundary (claude-code)
     * never emit a status; codex emits `in_progress` at item/started so clients can show a live
     * "compacting…" row until the completed re-emit merges over it. */
    status: z.enum(['in_progress', 'completed']).optional(),
    trigger: z.enum(['manual', 'auto']).optional(),
    /** Context tokens before / after the compaction, when the provider reports them. */
    preTokens: z.number().int().nonnegative().optional(),
    postTokens: z.number().int().nonnegative().optional(),
    /** The summary text the provider swapped in for the compacted turns. */
    summary: z.string().optional(),
  }),

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
  /** The reasoning-effort level the session is actually running at. Emitted on every switch and
   * once the resolved default is learned (claude-code via a Stop hook); never-emitted keeps the
   * client showing a placeholder rather than a guessed value. */
  z.object({ type: z.literal('effort-update'), effort: EffortLevelSchema }),
  /** Stable input capabilities for this live adapter session. Emitted at adapter start and replayed
   * on attach so clients never infer support from the agent kind. */
  z.object({
    type: z.literal('capabilities-update'),
    capabilities: AgentCapabilitiesSchema,
  }),
  /** The slash-command catalog the session accepts via `AgentInput.command` — emitted once
   * learned and on every provider-side change, full-replace semantics. */
  z.object({ type: z.literal('available-commands-update'), commands: z.array(AgentCommandSchema) }),
  /** The model catalog the session accepts via `AgentInput.set-model` — same full-replace contract
   * as the command catalog. Only adapters whose model set is install-dependent emit it (opencode);
   * agents with a curated static catalog (claude-code/codex) never do, and clients fall back to
   * their static tables. */
  z.object({ type: z.literal('available-models-update'), models: z.array(AgentModelOptionSchema) }),

  z.object({ type: z.literal('status'), status: SessionStatusSchema }),
  /** The provider-local native id of the live run, once learned — binds the session to provider
   * history for later resume. Adapters without history support never emit it. */
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
  z.object({
    type: z.literal('plugin-warning'),
    unitId: McpPluginIdSchema,
    /** The service dependency that failed, when the reason is service-scoped. */
    service: McpPluginServiceSchema.optional(),
    reason: PluginWarningReasonSchema,
  }),

  // Agent → client requests await a reply via AgentInput, correlated by requestId.
  PermissionRequestSchema.safeExtend({
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
