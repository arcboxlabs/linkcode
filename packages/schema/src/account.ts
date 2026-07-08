import { z } from 'zod';
import { AgentKindSchema, TimestampSchema } from './common';

/**
 * A model-provider credential in the global account pool (data plane, docs/ARCHITECTURE.md#packages--repo-layout).
 * The daemon persists these in ~/.linkcode/config.json (0600) and, at session start, resolves the
 * account bound to the agent (`providers[kind].activeAccountId`) and injects it into the adapter. One
 * credential can back several agents — natively when its endpoint speaks the agent's protocol, or via
 * conversion (a translating gateway or the daemon's local translator) otherwise.
 */

/** What an endpoint speaks on the wire; decides native-routing vs. conversion. */
export const AccountProtocolSchema = z.enum(['anthropic', 'openai-chat', 'openai-responses']);
export type AccountProtocol = z.infer<typeof AccountProtocolSchema>;

/** How an account's secret authenticates. */
export const AccountCredentialSchema = z.discriminatedUnion('type', [
  /** `x-api-key`-style provider key. */
  z.object({ type: z.literal('api-key'), key: z.string().min(1) }),
  /** Bearer token (e.g. `ANTHROPIC_AUTH_TOKEN`, or a gateway token). */
  z.object({ type: z.literal('auth-token'), token: z.string().min(1) }),
  /**
   * Delegates to the agent CLI's own login store — LinkCode stores no secret. An OAuth login is
   * specific to one CLI (claude's login is not codex's ChatGPT login), so the account names its agent.
   */
  z.object({ type: z.literal('oauth'), agent: AgentKindSchema }),
]);
export type AccountCredential = z.infer<typeof AccountCredentialSchema>;

/** A custom endpoint (gateway / relay / local translator). Absent means the agent's native default. */
export const AccountEndpointSchema = z.object({
  baseUrl: z.url(),
  protocol: AccountProtocolSchema,
});
export type AccountEndpoint = z.infer<typeof AccountEndpointSchema>;

export const AccountSchema = z.object({
  /** Stable id referenced by `providers[kind].activeAccountId` and `StartOptions.config.accountId`. */
  id: z.string().min(1),
  /** User-facing name. */
  label: z.string().min(1),
  credential: AccountCredentialSchema,
  endpoint: AccountEndpointSchema.optional(),
  /** Per-account default model (vendor-specific), overriding the provider default when set. */
  model: z.string().optional(),
  /** Extra environment injected into the agent process (escape hatch, e.g. gateway flags). */
  extraEnv: z.record(z.string(), z.string()).optional(),
  createdAt: TimestampSchema,
});
export type Account = z.infer<typeof AccountSchema>;

/** The global account pool, keyed by position; account ids are unique within it. */
export const AccountsSchema = z.array(AccountSchema);
export type Accounts = z.infer<typeof AccountsSchema>;
