import { z } from 'zod';
import {
  PluginProviderSchema,
  PluginProviderStatusSchema,
  PluginSchema,
  PluginScopeSchema,
  StandaloneSkillSchema,
  StandaloneSkillScopeSchema,
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
  /** Install a catalog entry the host does not have yet, or drop an installed one's local state.
   * Both are gated on the plugin's own `managementCapabilities`; an unsupporting provider replies
   * request.failed with `unsupported`. Uninstalling keeps the marketplace entry, so both directions
   * reply with the re-listed plugin. */
  z.object({
    kind: z.literal('plugin.install'),
    clientReqId: WireRequestIdSchema,
    provider: PluginProviderSchema,
    id: z.string().min(1),
    cwd: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('plugin.uninstall'),
    clientReqId: WireRequestIdSchema,
    provider: PluginProviderSchema,
    id: z.string().min(1),
    cwd: z.string().min(1).optional(),
  }),
  /** Success reply carrying the full updated plugin, so clients patch one cache entry instead of
   * re-running the expensive discovery. Failures use the shared request.failed reply. */
  z.object({
    kind: z.literal('plugin.updated'),
    replyTo: WireRequestIdSchema,
    plugin: PluginSchema,
    /** Install only: provider apps the install left unauthorized. LinkCode runs no OAuth flow, so
     * the names travel to the user rather than being dropped into a "done" that isn't. */
    pendingAuthApps: z.array(z.string().min(1)).optional(),
  }),
  /** Per-skill enablement. claude keys its `skillOverrides` by skill name, codex keys
   * `[[skills.config]]` by SKILL.md path — both travel so either adapter can address the skill.
   * On/off only: claude's `name-only`/`user-invocable-only` tiers stay provider-side for now. */
  z.object({
    kind: z.literal('skill.set-enabled'),
    clientReqId: WireRequestIdSchema,
    provider: PluginProviderSchema,
    skillId: z.string().min(1),
    path: z.string().min(1),
    scope: StandaloneSkillScopeSchema.optional(),
    enabled: z.boolean(),
    cwd: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal('skill.updated'),
    replyTo: WireRequestIdSchema,
    skill: StandaloneSkillSchema,
  }),
] as const;
