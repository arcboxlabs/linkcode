import { z } from 'zod';

/** Token usage / cost — a Link Code addition (not ACP vocabulary) so the UI can surface
 * consumption. Each adapter fills what its SDK reports; the rest stay undefined. */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** One plan rate-limit utilization window, self-describing: identity and length ride IN the
 * entry (`id`/`label`/`durationMins`), never in a field name or position, so any provider's
 * window set fits — claude-code's named windows and per-model buckets, codex's primary/secondary
 * limit families — and the UI labels a window by its own duration. */
export const UsageRateLimitWindowSchema = z.object({
  /** Stable identifier when the provider has one (claude `five_hour`/`seven_day`/…; codex
   * `limitId` such as `codex`). */
  id: z.string().optional(),
  /** Human label when the provider supplies one (claude per-model bucket display name such as
   * 'Fable'; codex `limitName`). */
  label: z.string().optional(),
  /** Percentage of the window used, 0–100. */
  utilization: z.number().nullable().optional(),
  /** ISO 8601 timestamp when the window resets. */
  resetsAt: z.string().nullable().optional(),
  /** Window length in minutes (5-hour = 300, weekly = 10080), when known. */
  durationMins: z.number().nullable().optional(),
});
export type UsageRateLimitWindow = z.infer<typeof UsageRateLimitWindowSchema>;

/** Share of local usage attributed to one named item (a subagent, skill, plugin, or MCP server). */
const UsageAttributionSchema = z.object({
  name: z.string(),
  /** Share of the weighted local usage attributed to this item, 0–100. */
  pct: z.number(),
});

/** Usage attribution over one time window (last 24h / last 7d) from the provider's local-transcript
 * scan. Behavior categories overlap — not a partition, so percentages don't sum to 100. */
const UsageBehaviorWindowSchema = z.object({
  /** API requests found in local transcripts for this window. */
  requestCount: z.number().int().nonnegative().optional(),
  /** Distinct sessions observed in this window. */
  sessionCount: z.number().int().nonnegative().optional(),
  /** Behavioral characteristics (e.g. long_context / subagent_heavy). Keys are provider-defined
   * and open-ended — plain strings so vendor additions ride through untouched. */
  behaviors: z
    .array(
      z.object({
        key: z.string(),
        pct: z.number(),
        count: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  agents: z.array(UsageAttributionSchema).optional(),
  skills: z.array(UsageAttributionSchema).optional(),
  plugins: z.array(UsageAttributionSchema).optional(),
  mcpServers: z.array(UsageAttributionSchema).optional(),
});

/**
 * Structured usage snapshot behind a provider's usage/cost command (claude-code `/usage`): session
 * cost and token totals, plan rate-limit utilization windows, and local-usage attribution. Shaped
 * by Link Code — NOT a mirror of any SDK type: claude-code's source API is experimental and its
 * renames/drift are absorbed by the adapter's mapper, never by this contract. Every section is
 * optional/nullable because availability depends on the account: `rateLimits` is null when plan
 * limits don't apply (API key / Bedrock / Vertex) and `behaviors` is null for non-subscriber
 * sessions.
 */
export const UsageReportSchema = z.object({
  /** Cost and usage accumulated by the current session. */
  session: z
    .object({
      totalCostUsd: z.number().nonnegative().optional(),
      totalApiDurationMs: z.number().nonnegative().optional(),
      totalDurationMs: z.number().nonnegative().optional(),
      totalLinesAdded: z.number().int().nonnegative().optional(),
      totalLinesRemoved: z.number().int().nonnegative().optional(),
      /** Per-model usage, keyed by the provider's model id. */
      modelUsage: z.record(z.string(), TokenUsageSchema).optional(),
    })
    .optional(),
  /** Subscription type (e.g. 'pro' / 'max' / 'team' / 'enterprise'), or null for API-key /
   * third-party provider sessions. */
  subscriptionType: z.string().nullable().optional(),
  /** Plan rate-limit utilization windows, or null when plan limits do not apply. The adapter
   * emits only the windows its provider actually reported, in the provider's own order — a
   * window the server declared unavailable is simply absent. */
  rateLimits: z
    .object({
      windows: z.array(UsageRateLimitWindowSchema).optional(),
      /** Pay-per-use overage on top of the plan windows, when the account has it enabled. */
      extraUsage: z
        .object({
          isEnabled: z.boolean().optional(),
          monthlyLimit: z.number().nullable().optional(),
          usedCredits: z.number().nullable().optional(),
          utilization: z.number().nullable().optional(),
          currency: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  /** What's contributing to limits usage (last 24h / last 7d), from the provider's scan of local
   * transcripts on this machine — approximate, excludes other devices. Null for non-subscriber
   * sessions. */
  behaviors: z
    .object({
      day: UsageBehaviorWindowSchema.optional(),
      week: UsageBehaviorWindowSchema.optional(),
    })
    .nullable()
    .optional(),
});
export type UsageReport = z.infer<typeof UsageReportSchema>;
