import { z } from 'zod';
import {
  PluginProviderSchema,
  PluginProviderStatusSchema,
  PluginSchema,
  PluginScopeSchema,
  StandaloneSkillSchema,
} from '../model/plugin';
import { WireRequestIdSchema } from './request';

/** Plugin discovery + management wire variants. Discovery shells out to provider CLIs, so it is
 * client-triggered (no server-side cache, no push invalidation); `cwd` scopes project-level
 * marketplaces and skills. */
export const pluginWireVariants = [
  z.object({
    kind: z.literal('plugin.list.get'),
    clientReqId: WireRequestIdSchema,
    cwd: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('plugin.list.result'),
    replyTo: WireRequestIdSchema,
    plugins: z.array(PluginSchema),
    standaloneSkills: z.array(StandaloneSkillSchema),
    /** One entry per known provider, so "no plugins" and "CLI failed" stay distinguishable. */
    providerStatus: z.array(PluginProviderStatusSchema),
  }),
  /** Plugin-level enable/disable. No component-level variant exists: no provider implements one. */
  z.object({
    kind: z.literal('plugin.set-enabled'),
    clientReqId: WireRequestIdSchema,
    provider: PluginProviderSchema,
    id: z.string().min(1),
    enabled: z.boolean(),
    scope: PluginScopeSchema.optional(),
    cwd: z.string().min(1).optional(),
  }),
  /** Success reply carrying the full updated plugin, so clients patch one cache entry instead of
   * re-running the expensive discovery. Failures use the shared request.failed reply. */
  z.object({
    kind: z.literal('plugin.updated'),
    replyTo: WireRequestIdSchema,
    plugin: PluginSchema,
  }),
] as const;
