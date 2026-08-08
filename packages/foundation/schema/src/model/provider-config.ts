import { z } from 'zod';
import { AgentKindSchema } from './primitives';

/** Daemon-owned per-agent provider configuration (data plane), persisted in ~/.linkcode/config.json
 * and applied to StartOptions at session start. Unlike system-plane desktop settings, it travels
 * over `transport`, never over TypeSafe IPC. */
export const ProviderConfigSchema = z.object({
  /** Whether the agent is offered in the client's agent picker. */
  enabled: z.boolean().default(true),
  /** The model this agent currently runs on, picked by the user from the bound account's set and
   * persisted so it survives across sessions. Not a fallback default: unset means no session can
   * start, because nothing else resolves a model. */
  model: z.string().optional(),
  /** Legacy provider API key, superseded by the global account pool (`account.ts`) but kept so
   * pre-account configs still load; the resolver falls back to it when `activeAccountId` is unset. */
  apiKey: z.string().optional(),
  /** Id of the pooled `Account` this agent falls back to when nothing names one: automation,
   * schedules, and IM-created threads, plus a new session started without picking a model.
   * Sessions started from a picker carry their own account and never consult this. */
  activeAccountId: z.string().optional(),
  /** The accounts whose models this agent offers in its pickers. **Absent means every bindable
   * account**, so an added account is offered without a trip through Settings; an explicit list is
   * the user narrowing it. Availability still gates it — listing an account that cannot back this
   * agent offers nothing. */
  enabledAccountIds: z.array(z.string().min(1)).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** Provider configuration keyed by agent kind; only configured agents are present. */
export const ProvidersConfigSchema = z.partialRecord(AgentKindSchema, ProviderConfigSchema);
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
