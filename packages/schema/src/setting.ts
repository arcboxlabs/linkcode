import { z } from 'zod';
import { AgentKindSchema } from './common';
import { McpServerSchema } from './session';

/**
 * Setting — the persistent, user-configured layer that backs the Setting page. 🔧 Proposed starting point — not a final contract.
 *
 * Deliberately distinct from the two contracts that already exist (PLAN §2.1: schema first):
 *   - `StartOptions` (agent.ts) — per-session launch context: `cwd` / `resume` / `modeId`.
 *   - `AgentInput`   (agent.ts) — runtime actions: `prompt` / `cancel` / `set-mode`.
 * A Setting holds DEFAULTS the user edits once; they resolve into `StartOptions` (and `StartOptions.config`)
 * when a session starts. Runtime mechanics (streaming, cancel, session resume) never appear here — they are
 * already modeled as `AgentEvent` / `AgentInput`, so they are out of scope for the Setting page by construction.
 *
 * Typed surface = the parameters all four vendors share (model · auth · reasoning · instructions · tools · env ·
 * auto-compaction, plus MCP for 3-of-4). Everything vendor-specific stays in the free-form `config` field.
 */

// ── Reusable setting fragments (shared in concept by ≥2 agents) ──────────────

/**
 * Unified reasoning-effort / thinking scale. Adapters clamp to their vendor's supported set:
 * claude `effort` (off→xhigh) · codex `model_reasoning_effort` (no 'xhigh') · pi `thinkingLevel` · opencode `variant`.
 */
export const ReasoningEffortSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

/**
 * How credentials are supplied. Unifies claude `apiKeyHelper`/`forceLoginMethod` · codex `apiKey`/login ·
 * opencode `auth.type` · pi `auth.{type,env}`.
 */
export const AuthSettingSchema = z.discriminatedUnion('source', [
  /** Use the agent's own subscription / OAuth login. Link Code stores no key. */
  z.object({ source: z.literal('oauth') }),
  /** Read the API key from an environment variable at session start (key is not persisted). */
  z.object({ source: z.literal('env'), envVar: z.string().min(1) }),
  /** Run a command that prints the key to stdout — mirrors claude `apiKeyHelper`. */
  z.object({ source: z.literal('helper'), command: z.string().min(1) }),
  /** Inline key. ⚠️ Persisted in the settings store — prefer 'env' / 'helper' / 'oauth' (or an OS keychain). */
  z.object({ source: z.literal('apiKey'), apiKey: z.string().min(1) }),
]);
export type AuthSetting = z.infer<typeof AuthSettingSchema>;

/** Custom model provider / endpoint. codex `model_provider`+`base_url` · opencode `provider`+`baseURL` · pi `providerConfig`. */
export const ProviderSettingSchema = z.object({
  /** Provider id (vendor-specific, e.g. 'anthropic', 'openai', a custom gateway). */
  id: z.string().min(1).optional(),
  /** Override the API base URL (custom gateway / self-host / proxy). */
  baseUrl: z.string().min(1).optional(),
  /** Extra HTTP headers sent to the provider. */
  headers: z.record(z.string(), z.string()).optional(),
});
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>;

/**
 * Default tool gating. `allow` = only these are auto-permitted; `deny` = never available. Tool names are
 * vendor-specific. Maps to claude `allowedTools`/`disallowedTools` · pi `allowedToolNames`/`excludedToolNames` ·
 * opencode `tools` map · codex `tool_suggest.disabled_tools`.
 */
export const ToolPolicySettingSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});
export type ToolPolicySetting = z.infer<typeof ToolPolicySettingSchema>;

/** Automatic context compaction. claude `autoCompact*` · codex `model_auto_compact_token_limit` · opencode/pi `compaction.*`. */
export const AutoCompactionSettingSchema = z.object({
  enabled: z.boolean().optional(),
  /** Trigger compaction when the context exceeds this many tokens (adapter clamps to the model's limit). */
  thresholdTokens: z.number().int().positive().optional(),
});
export type AutoCompactionSetting = z.infer<typeof AutoCompactionSettingSchema>;

// ── Per-agent settings ───────────────────────────────────────────────────────

/**
 * Settings for a single agent. Every field is optional: unset = use the agent's own built-in default.
 * The typed fields are the cross-vendor common surface; `config` carries vendor-specific options that are
 * merged verbatim into `StartOptions.config` at session start — e.g. claude `permissionMode`/`sandbox.*`,
 * codex `approvalPolicy`/`sandboxMode`, opencode `permission.*`, pi `steeringMode`/`thinkingBudgets`.
 */
export const AgentSettingsSchema = z.object({
  /** Default model id, in the vendor's own form (e.g. 'claude-…', 'gpt-…', 'provider/model'). */
  model: z.string().min(1).optional(),
  /** Custom provider / endpoint. */
  provider: ProviderSettingSchema.optional(),
  /** Default reasoning effort / thinking level. */
  reasoningEffort: ReasoningEffortSchema.optional(),
  /** How to authenticate. */
  auth: AuthSettingSchema.optional(),
  /** Text appended to the agent's system prompt (custom instructions). */
  appendSystemPrompt: z.string().optional(),
  /** Default tool allow / deny policy. */
  tools: ToolPolicySettingSchema.optional(),
  /** Environment variables injected into the agent process. */
  env: z.record(z.string(), z.string()).optional(),
  /** Automatic context compaction. */
  autoCompaction: AutoCompactionSettingSchema.optional(),
  /** Default MCP servers. ❓ pi has no native MCP support — ignored by the pi adapter. */
  mcpServers: z.array(McpServerSchema).optional(),
  /** Vendor-specific options, merged verbatim into `StartOptions.config`. */
  config: z.record(z.string(), z.unknown()).optional(),
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

/**
 * Cross-agent defaults. A subset of `AgentSettings` — only fields whose value is meaningful across vendors.
 * `model` / `provider` / `auth` / `mcpServers` / `config` are intentionally excluded: their values are
 * vendor-specific and belong under a specific agent.
 */
export const SharedSettingsSchema = AgentSettingsSchema.pick({
  reasoningEffort: true,
  appendSystemPrompt: true,
  tools: true,
  env: true,
  autoCompaction: true,
});
export type SharedSettings = z.infer<typeof SharedSettingsSchema>;

// ── Top-level Setting document ─────────────────────────────────────────────────

/**
 * The full settings document the Setting page edits. Resolution at session start (later wins):
 *   `shared`  →  `agents[kind]`  →  explicit `StartOptions` passed by the caller.
 */
export const SettingSchema = z.object({
  /** Schema version, for forward migration. */
  version: z.literal(1),
  /** Defaults applied to every agent unless overridden per agent. */
  shared: SharedSettingsSchema.optional(),
  /** Per-agent settings & overrides. Partial: omit an agent to fall back to `shared` + its built-in defaults. */
  agents: z.partialRecord(AgentKindSchema, AgentSettingsSchema).optional(),
});
export type Setting = z.infer<typeof SettingSchema>;
