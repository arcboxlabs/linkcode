import { z } from 'zod';
import { AgentKindSchema } from './common';

/**
 * Daemon-owned per-agent provider configuration (data plane, docs/ARCHITECTURE.md#packages--repo-layout).
 * The daemon persists this in ~/.linkcode/config.json and applies it to StartOptions at session
 * start. Unlike system-plane desktop settings, it travels over `transport`, never over TypeSafe IPC.
 */
export const ProviderConfigSchema = z.object({
  /** Whether the agent is offered in the client's agent picker. */
  enabled: z.boolean().default(true),
  /** Default model used when the client starts a session without specifying one. */
  defaultModel: z.string().optional(),
  /** Provider API key, injected into the adapter at session start. */
  apiKey: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** Provider configuration keyed by agent kind; only configured agents are present. */
export const ProvidersConfigSchema = z.partialRecord(AgentKindSchema, ProviderConfigSchema);
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
