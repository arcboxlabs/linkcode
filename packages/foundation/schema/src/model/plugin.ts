import { z } from 'zod';
import { ManagedToolAssetIdSchema } from './managed-asset';

/** Agent plugin formats LinkCode can discover without translating either vendor's package. */
export const PluginProviderSchema = z.enum(['claude-code', 'codex']);
export type PluginProvider = z.infer<typeof PluginProviderSchema>;

/** Provider-native marketplace identity. Names are opaque outside the owning adapter. */
export const PluginMarketplaceSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  /** Absolute path on the daemon host when the provider exposes one. */
  path: z.string().min(1).optional(),
});
export type PluginMarketplace = z.infer<typeof PluginMarketplaceSchema>;

/**
 * Where the provider obtains the plugin package. This is descriptive metadata, not an install
 * instruction: adapters continue to invoke each provider's native marketplace/install flow.
 */
export const PluginSourceSchema = z.discriminatedUnion('type', [
  /** Absolute package path on the daemon host. */
  z.object({ type: z.literal('local'), path: z.string().min(1) }),
  z.object({
    type: z.literal('git'),
    url: z.string().min(1),
    path: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('npm'),
    package: z.string().min(1),
    version: z.string().min(1).optional(),
    registry: z.httpUrl().optional(),
  }),
  /** A provider-hosted catalog entry whose underlying package source is not exposed. */
  z.object({ type: z.literal('remote'), url: z.httpUrl().optional() }),
]);
export type PluginSource = z.infer<typeof PluginSourceSchema>;

/** Component kinds are a union, not a common-denominator capability list. */
export const PluginComponentKindSchema = z.enum([
  'skill',
  'command',
  'agent',
  'hook',
  'mcp-server',
  'lsp-server',
  'output-style',
  'channel',
  'app',
  'app-template',
]);
export type PluginComponentKind = z.infer<typeof PluginComponentKindSchema>;

/** Provider-reported component inventory. Native component files remain owned by the provider. */
export const PluginComponentSchema = z.object({
  kind: PluginComponentKindSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type PluginComponent = z.infer<typeof PluginComponentSchema>;

export const PluginScopeSchema = z.enum(['user', 'project', 'local', 'managed']);
export type PluginScope = z.infer<typeof PluginScopeSchema>;

/**
 * One provider install record. Claude Code can install one plugin at multiple scopes; enabled is
 * therefore per record and never implies loaded in a running session. Codex emits at most one.
 */
export const PluginInstallationSchema = z.object({
  enabled: z.boolean(),
  version: z.string().min(1).optional(),
  scope: PluginScopeSchema.optional(),
  /** Absolute provider materialization path on the daemon host, when exposed. */
  path: z.string().min(1).optional(),
});
export type PluginInstallation = z.infer<typeof PluginInstallationSchema>;

/** Whether host/provider policy permits the plugin; independent of installation state. */
export const PluginAvailabilitySchema = z.enum(['available', 'blocked', 'unknown']);
export type PluginAvailability = z.infer<typeof PluginAvailabilitySchema>;

/**
 * Stable management operations implemented by the owning adapter. Clients combine these with
 * availability and installation state; they never infer support from `provider`.
 */
export const PluginManagementCapabilitiesSchema = z.object({
  install: z.boolean(),
  uninstall: z.boolean(),
  update: z.boolean(),
  enable: z.boolean(),
  disable: z.boolean(),
});
export type PluginManagementCapabilities = z.infer<typeof PluginManagementCapabilitiesSchema>;

export const PluginAuthorSchema = z.object({
  name: z.string().min(1),
  email: z.email().optional(),
  url: z.url().optional(),
});
export type PluginAuthor = z.infer<typeof PluginAuthorSchema>;

export const PluginLinksSchema = z.object({
  homepage: z.url().optional(),
  repository: z.url().optional(),
  privacyPolicy: z.url().optional(),
  termsOfService: z.url().optional(),
});
export type PluginLinks = z.infer<typeof PluginLinksSchema>;

/**
 * A plugin's compatibility requirement on a trusted managed tool. The host selects the exact
 * version; `versionRange` only gates compatibility and never instructs the host what to download.
 */
export const PluginAssetRequirementSchema = z.object({
  id: ManagedToolAssetIdSchema,
  versionRange: z.string().min(1).optional(),
});
export type PluginAssetRequirement = z.infer<typeof PluginAssetRequirementSchema>;

const pluginFields = {
  /** Opaque provider-native id; pair with `provider` for identity. */
  id: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  /** Marketplace-advertised version; installed versions live under `installations`. */
  version: z.string().min(1).optional(),
  author: PluginAuthorSchema.optional(),
  category: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)),
  links: PluginLinksSchema.optional(),
  marketplace: PluginMarketplaceSchema.optional(),
  source: PluginSourceSchema.optional(),
  availability: PluginAvailabilitySchema,
  /** One entry per provider install record; an empty list means not installed. */
  installations: z.array(PluginInstallationSchema),
  components: z.array(PluginComponentSchema),
  /**
   * Managed runtime dependencies required by this plugin. Plugins declare trusted catalog ids and
   * optional compatibility ranges; exact versions, download URLs, and integrity stay host-owned.
   */
  assets: z.array(PluginAssetRequirementSchema),
  managementCapabilities: PluginManagementCapabilitiesSchema,
} as const;

/**
 * Normalized read model for plugin catalog/UI state. The provider discriminator deliberately
 * remains in the union: adapters read and mutate Claude Code/Codex packages in their native
 * formats, and provider-only fields can be added to the relevant branch without distorting the
 * other provider.
 */
export const PluginSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('claude-code'), ...pluginFields }),
  z.object({ provider: z.literal('codex'), ...pluginFields }),
]);
export type Plugin = z.infer<typeof PluginSchema>;
