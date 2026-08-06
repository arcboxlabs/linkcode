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

/** An explicitly named endpoint: a custom account's own, or the local translator's. Outranks the
 * service catalog; absent means the endpoint is resolved per agent from `service`. */
export const AccountEndpointSchema = z.object({
  baseUrl: z.url(),
  protocol: AccountProtocolSchema,
});
export type AccountEndpoint = z.infer<typeof AccountEndpointSchema>;

/** A model an account can run on: read from the service's own model list, or typed by the user for
 * an endpoint that serves no list. `label` is the provider's display name when it ships one. */
export const AccountModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
});
export type AccountModel = z.infer<typeof AccountModelSchema>;

export const AccountSchema = z.object({
  /** Stable id referenced by `providers[kind].activeAccountId` and `StartOptions.config.accountId`. */
  id: z.string().min(1),
  /** User-facing name. */
  label: z.string().min(1),
  /** Service-catalog key the account was created from (e.g. `openrouter`). Drives brand
   * presentation and, when `endpoint` is absent, resolves the endpoint each agent uses.
   * Absent for custom and pre-catalog accounts. */
  service: z.string().optional(),
  credential: AccountCredentialSchema,
  endpoint: AccountEndpointSchema.optional(),
  /** Values for a catalog endpoint's `{placeholder}` segments (e.g. Cloudflare's account and
   * gateway ids). The account holds these rather than a resolved URL, because one secret can
   * resolve to a different endpoint per agent. */
  endpointParams: z.record(z.string(), z.string()).optional(),
  /** The models the user picked for this account, and the only ones its pickers offer. Fetched from
   * the service's model list, typed in freehand, or both; an empty or absent set means no session
   * can start on this account until the user picks one. */
  models: z.array(AccountModelSchema).optional(),
  /** Extra environment injected into the agent process (escape hatch, e.g. gateway flags). */
  extraEnv: z.record(z.string(), z.string()).optional(),
  createdAt: TimestampSchema,
});
export type Account = z.infer<typeof AccountSchema>;

/** The global account pool, keyed by position; account ids are unique within it. */
export const AccountsSchema = z.array(AccountSchema);
export type Accounts = z.infer<typeof AccountsSchema>;
