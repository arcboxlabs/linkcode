import { z } from 'zod';
import { AgentKindSchema } from './primitives';

/** Daemon-owned per-agent provider configuration (data plane), persisted in ~/.linkcode/config.json
 * and applied to StartOptions at session start. Unlike system-plane desktop settings, it travels
 * over `transport`, never over TypeSafe IPC. */
export const ProviderConfigSchema = z.object({
  /** Whether the agent is offered in the client's agent picker. */
  enabled: z.boolean().default(true),
  /** Legacy provider API key, superseded by the global account pool (`account.ts`) but kept so
   * pre-account configs still load; the resolver falls back to it when no account resolves. */
  apiKey: z.string().optional(),
  /**
   * The accounts whose models this agent offers in its pickers. **Absent means every bindable
   * account**, so an added account is offered without a trip through Settings; an explicit list is
   * the user narrowing it. Availability still gates it — listing an account that cannot back this
   * agent offers nothing.
   *
   * This is an agent's only per-account state. There is no default account and no default model:
   * a request that names neither resolves to the head of `enabledAccountModels`, which the client
   * shows and the daemon starts on, so neither side can invent an answer the other disagrees with.
   */
  enabledAccountIds: z.array(z.string().min(1)).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** Provider configuration keyed by agent kind; only configured agents are present. */
export const ProvidersConfigSchema = z.partialRecord(AgentKindSchema, ProviderConfigSchema);
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
