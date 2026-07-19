import { z } from 'zod';
import { AgentKindSchema } from './primitives';

/**
 * Where the spawnable CLI behind an agent kind comes from, in resolution order:
 * `managed` = daemon-installed SDK-paired binary (CODE-111); `detected` = user-installed CLI,
 * version-probed; `sdk` = the SDK resolves its own platform package; `builtin` = in-process (pi).
 */
export const AgentRuntimeSourceSchema = z.enum(['managed', 'detected', 'sdk', 'builtin']);
export type AgentRuntimeSource = z.infer<typeof AgentRuntimeSourceSchema>;

/** Provider login status for an agent CLI (claude-code only for now). Absent when the host could
 * not determine it — a fail-open the onboarding UI reads as "don't block"; only an explicit
 * `loggedIn: false` drives the login cue. */
export const AgentAuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  /** Login method the CLI reports, e.g. `claude.ai` (subscription) or `console` (API billing). */
  method: z.string().optional(),
  /** Subscription tier for a subscription login, e.g. `max` / `pro`. */
  subscriptionType: z.string().optional(),
  /** Signed-in identity the CLI reports — the account email. */
  email: z.string().optional(),
});
export type AgentAuthStatus = z.infer<typeof AgentAuthStatusSchema>;

export const AgentRuntimeAvailabilitySchema = z.object({
  /** `out-of-range` is reserved until the compat manifest (CODE-77) gates detected versions;
   * until then a detected runtime reports `available`. */
  status: z.enum(['available', 'out-of-range', 'missing']),
  source: AgentRuntimeSourceSchema.optional(),
  /** Absolute binary path; absent for `sdk` (resolution happens inside the SDK) and `builtin`. */
  path: z.string().optional(),
  /** CLI version as reported by `--version`; absent when the source carries no probeable binary. */
  version: z.string().optional(),
  /** Login status for a probeable runtime (claude-code only for now); absent when unprobed or
   * undeterminable, present with `loggedIn: false` when installed but signed out. */
  auth: AgentAuthStatusSchema.optional(),
});
export type AgentRuntimeAvailability = z.infer<typeof AgentRuntimeAvailabilitySchema>;

/** Per-agent-kind runtime availability; kinds the host has not evaluated are simply absent. */
export const AgentRuntimesSchema = z.partialRecord(AgentKindSchema, AgentRuntimeAvailabilitySchema);
export type AgentRuntimes = z.infer<typeof AgentRuntimesSchema>;
