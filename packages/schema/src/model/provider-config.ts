import { z } from 'zod';
import { AgentKindSchema } from './primitives';

/** Daemon-owned per-agent provider configuration (data plane), persisted in ~/.linkcode/config.json
 * and applied to StartOptions at session start. Unlike system-plane desktop settings, it travels
 * over `transport`, never over TypeSafe IPC. */
export const ProviderConfigSchema = z.object({
  /** Whether the agent is offered in the client's agent picker. */
  enabled: z.boolean().default(true),
  /** Default model used when the client starts a session without specifying one. */
  defaultModel: z.string().optional(),
  /** Legacy provider API key, superseded by the global account pool (`account.ts`) but kept so
   * pre-account configs still load; the resolver falls back to it when `activeAccountId` is unset. */
  apiKey: z.string().optional(),
  /** Id of the pooled `Account` this agent's new sessions use (see `account.ts`). */
  activeAccountId: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** Provider configuration keyed by agent kind; only configured agents are present. */
export const ProvidersConfigSchema = z.partialRecord(AgentKindSchema, ProviderConfigSchema);
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
