import { z } from 'zod';
import { AgentKindSchema, TimestampSchema } from './primitives';

/**
 * A model-provider credential in the global account pool (data plane). The daemon persists these
 * in ~/.linkcode/config.json (0600) and injects the agent's bound account (`activeAccountId`) into
 * the adapter at session start. One credential can back several agents — natively when its
 * endpoint speaks the agent's protocol, via conversion otherwise.
 */

/** What an endpoint speaks on the wire; decides native-routing vs. conversion. */
export const AccountProtocolSchema = z.enum(['anthropic', 'openai-chat', 'openai-responses']);
export type AccountProtocol = z.infer<typeof AccountProtocolSchema>;

/** The secret shapes LinkCode itself holds — the only ones that can authenticate a direct request
 * to an endpoint (an `oauth` account has no secret here, so it cannot). */
export const AccountSecretSchema = z.discriminatedUnion('type', [
  /** `x-api-key`-style provider key. */
  z.object({ type: z.literal('api-key'), key: z.string().min(1) }),
  /** Bearer token (e.g. `ANTHROPIC_AUTH_TOKEN`, or a gateway token). */
  z.object({ type: z.literal('auth-token'), token: z.string().min(1) }),
]);
export type AccountSecret = z.infer<typeof AccountSecretSchema>;

/** How an account's secret authenticates. */
export const AccountCredentialSchema = z.discriminatedUnion('type', [
  ...AccountSecretSchema.options,
  /** Delegates to the agent CLI's own login store — LinkCode stores no secret. An OAuth login is
   * specific to one CLI, so the account names its agent. */
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
  /** Service-catalog key the account was created from (e.g. `openrouter`). Drives brand
   * presentation and, when `endpoint` is absent, implies the protocol a bare key speaks.
   * Absent for custom and pre-catalog accounts. */
  service: z.string().optional(),
  credential: AccountCredentialSchema,
  endpoint: AccountEndpointSchema.optional(),
  /** Per-account default model (vendor-specific), overriding the provider default when set. */
  model: z.string().optional(),
  /** Extra environment injected into the agent process (escape hatch, e.g. gateway flags). */
  extraEnv: z.record(z.string(), z.string()).optional(),
  createdAt: TimestampSchema,
});
export type Account = z.infer<typeof AccountSchema>;

/** A model an endpoint advertises on its own model list, as read by the daemon's probe. `label` is
 * the provider's display name when it ships one; relays usually ship the bare id only. */
export const AccountModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
});
export type AccountModel = z.infer<typeof AccountModelSchema>;

/** The global account pool, keyed by position; account ids are unique within it. */
export const AccountsSchema = z.array(AccountSchema);
export type Accounts = z.infer<typeof AccountsSchema>;
