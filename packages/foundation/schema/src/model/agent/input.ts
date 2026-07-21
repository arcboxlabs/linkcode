import { z } from 'zod';
import { ContentBlockSchema } from '../content';
import { ImPlatformSchema } from '../im';
import { PermissionOutcomeSchema } from '../permission';
import type { AgentKind } from '../primitives';
import { AgentKindSchema } from '../primitives';
import { QuestionOutcomeSchema } from '../question';
import {
  ApprovalPolicyIdSchema,
  ApprovalPolicySchema,
  SessionModeIdSchema,
} from '../session/control';

/**
 * Agent input contract: session start configuration and the normalized actions clients send to a
 * live adapter.
 */

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

/** Normalized reasoning-effort levels. Availability is provider- and model-specific: `max` is
 * startup-only for claude-code but a normal per-turn Codex value; Codex `ultra` enables proactive
 * multi-agent behavior, while claude-code's distinct `ultracode` mode switches live. */
export const EffortLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'ultracode',
]);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

/** Parameters required to start an agent session. */
export const StartOptionsSchema = z.object({
  kind: AgentKindSchema,
  /** Working directory (the root of the repository the agent operates on). */
  cwd: z.string().min(1),
  /** Model id override (vendor-specific). Undefined applies the LinkCode-configured default;
   * null explicitly defers to the agent/provider's own default. */
  model: z.string().nullable().optional(),
  /** Initial session mode (e.g. plan / accept-edits), if the agent advertises modes. */
  modeId: SessionModeIdSchema.optional(),
  /** Initial reasoning effort, if the selected adapter supports effort. */
  effort: EffortLevelSchema.optional(),
  /** Initial approval-policy tier, if explicitly selected before session start. */
  approvalPolicyId: ApprovalPolicyIdSchema.optional(),
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

/** A model an adapter accepts via `AgentInput.set-model`, advertised before session start and/or
 * on a live session. `id` is the exact value to send back on `set-model`. */
export const AgentModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  /** Absent means unknown; an empty list means this model has no effort axis. */
  effortLevels: z.array(EffortLevelSchema).optional(),
  /** Provider default for this model, when the catalog advertises one. */
  defaultEffort: EffortLevelSchema.optional(),
});
export type AgentModelOption = z.infer<typeof AgentModelOptionSchema>;

export const AgentStartCatalogSchema = z.object({
  models: z.array(AgentModelOptionSchema),
  policies: z.array(ApprovalPolicySchema),
  defaultPolicyId: ApprovalPolicyIdSchema.optional(),
});
export type AgentStartCatalog = z.infer<typeof AgentStartCatalogSchema>;

/** Input features a live adapter session accepts. Kept separate from command catalogs: catalogs
 * change provider-side, while these booleans describe the adapter's stable input surface. */
export const AgentCapabilitiesSchema = z.object({
  slashCommands: z.boolean(),
  shellCommand: z.boolean(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

/** Stable pre-session input capabilities. Live clients still trust each session's
 * `capabilities-update`; this complete matrix lets drafts and adapters share one source of truth
 * before that event stream exists. */
export const AGENT_INPUT_CAPABILITIES = {
  'claude-code': { slashCommands: true, shellCommand: false },
  codex: { slashCommands: true, shellCommand: true },
  opencode: { slashCommands: true, shellCommand: true },
  pi: { slashCommands: false, shellCommand: false },
  'grok-build': { slashCommands: false, shellCommand: false },
} as const satisfies Readonly<Record<AgentKind, AgentCapabilities>>;

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
