import { split0th } from 'foxts/split-nth';
import { z } from 'zod';
import {
  LinkCodeMarketplaceIdSchema,
  LinkCodePluginIdSchema,
  LinkCodePluginReleaseSchema,
  LinkCodePluginVersionSchema,
} from './linkcode-plugin';
import { TimestampSchema } from './primitives';

const HTTPS_URL_RE = /^https:\/\//i;

const LinkCodeMarketplaceHttpsUrlSchema = z
  .url()
  .refine((url) => HTTPS_URL_RE.test(url), 'Expected an absolute HTTPS URL');

/** HTTPS index configured by the user; the remote document never chooses its local identity. */
export const LinkCodeMarketplaceRemoteSourceSchema = z.object({
  type: z.literal('remote'),
  url: LinkCodeMarketplaceHttpsUrlSchema,
});
export type LinkCodeMarketplaceRemoteSource = z.infer<typeof LinkCodeMarketplaceRemoteSourceSchema>;

/** Source variants LinkCode knows how to refresh. Additional source types can be added later. */
export const LinkCodeMarketplaceSourceSchema = LinkCodeMarketplaceRemoteSourceSchema;
export type LinkCodeMarketplaceSource = z.infer<typeof LinkCodeMarketplaceSourceSchema>;

/** Mutable local configuration for one official or user-added marketplace. */
export const LinkCodeMarketplaceConfigSchema = z.object({
  id: LinkCodeMarketplaceIdSchema,
  displayName: z.string().min(1).optional(),
  source: LinkCodeMarketplaceSourceSchema,
  enabled: z.boolean(),
});
export type LinkCodeMarketplaceConfig = z.infer<typeof LinkCodeMarketplaceConfigSchema>;

/** Multiple marketplaces may coexist, but each local provenance id is unique. */
export const LinkCodeMarketplaceConfigListSchema = z
  .array(LinkCodeMarketplaceConfigSchema)
  .superRefine((marketplaces, ctx) => {
    const ids = new Set<string>();
    for (const [index, marketplace] of marketplaces.entries()) {
      if (ids.has(marketplace.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate marketplace id: ${marketplace.id}`,
          path: [index, 'id'],
        });
      }
      ids.add(marketplace.id);
    }
  });
export type LinkCodeMarketplaceConfigList = z.infer<typeof LinkCodeMarketplaceConfigListSchema>;

function validateMarketplacePlugin(
  plugin: { id: string; releases: Array<z.infer<typeof LinkCodePluginReleaseSchema>> },
  ctx: z.RefinementCtx,
): void {
  const versions = new Set<string>();
  for (const [index, release] of plugin.releases.entries()) {
    if (release.manifest.id !== plugin.id) {
      ctx.addIssue({
        code: 'custom',
        message: `Release plugin id ${release.manifest.id} does not match ${plugin.id}`,
        path: ['releases', index, 'manifest', 'id'],
      });
    }
    const precedenceVersion = split0th(release.manifest.version, '+');
    if (versions.has(precedenceVersion)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate plugin release precedence: ${precedenceVersion}`,
        path: ['releases', index, 'manifest', 'version'],
      });
    }
    versions.add(precedenceVersion);
  }
}

const compatibleReleaseListSchema = z
  .array(z.unknown())
  .transform((releases) =>
    releases.flatMap((release) => {
      const result = LinkCodePluginReleaseSchema.safeParse(release);
      return result.success ? [result.data] : [];
    }),
  )
  .refine((releases) => releases.length > 0, 'Expected at least one compatible plugin release');

/** Releases for one plugin in an authored marketplace index. */
export const LinkCodeMarketplacePluginSchema = z
  .strictObject({
    id: LinkCodePluginIdSchema,
    releases: z.array(LinkCodePluginReleaseSchema).min(1),
  })
  .superRefine(validateMarketplacePlugin);
export type LinkCodeMarketplacePlugin = z.infer<typeof LinkCodeMarketplacePluginSchema>;

/** Reader that retains compatible releases while dropping versions this client cannot represent. */
const LinkCodeMarketplacePluginReaderSchema = z
  .object({
    id: LinkCodePluginIdSchema,
    releases: compatibleReleaseListSchema,
  })
  .superRefine(validateMarketplacePlugin);

function rejectDuplicatePlugins(
  index: { plugins: Array<{ id: string }> },
  ctx: z.RefinementCtx,
): void {
  const pluginIds = new Set<string>();
  for (const [pluginIndex, plugin] of index.plugins.entries()) {
    if (pluginIds.has(plugin.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate marketplace plugin id: ${plugin.id}`,
        path: ['plugins', pluginIndex, 'id'],
      });
    }
    pluginIds.add(plugin.id);
  }
}

const linkCodeMarketplaceIndexFields = {
  indexVersion: z.literal(1),
  name: z.string().min(1),
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  plugins: z.array(LinkCodeMarketplacePluginSchema),
} as const;

/**
 * Authored static index. It carries no configured marketplace id: provenance is assigned by the
 * local source configuration that supplied these bytes.
 */
export const LinkCodeMarketplaceIndexSchema = z
  .strictObject(linkCodeMarketplaceIndexFields)
  .superRefine(rejectDuplicatePlugins);
export type LinkCodeMarketplaceIndex = z.infer<typeof LinkCodeMarketplaceIndexSchema>;

/**
 * Forward-compatible remote reader. Unknown fields are stripped, and plugins with no release this
 * client can represent are omitted without hiding compatible entries from the same marketplace.
 */
export const LinkCodeMarketplaceIndexReaderSchema = z
  .object({
    ...linkCodeMarketplaceIndexFields,
    plugins: z.array(z.unknown()).transform((plugins) =>
      plugins.flatMap((plugin) => {
        const result = LinkCodeMarketplacePluginReaderSchema.safeParse(plugin);
        return result.success ? [result.data] : [];
      }),
    ),
  })
  .superRefine(rejectDuplicatePlugins);
export type LinkCodeMarketplaceIndexReader = z.infer<typeof LinkCodeMarketplaceIndexReaderSchema>;

/** Stable cross-marketplace release identity used by selection and future Store operations. */
export const LinkCodeMarketplaceReleaseIdentitySchema = z.object({
  marketplaceId: LinkCodeMarketplaceIdSchema,
  pluginId: LinkCodePluginIdSchema,
  version: LinkCodePluginVersionSchema,
});
export type LinkCodeMarketplaceReleaseIdentity = z.infer<
  typeof LinkCodeMarketplaceReleaseIdentitySchema
>;

/** Mutable HTTP cache validators and refresh timestamps, stored separately from the index. */
export const LinkCodeMarketplaceRefreshStateSchema = z.object({
  marketplaceId: LinkCodeMarketplaceIdSchema,
  /** Exact request URL that produced these validators; discard when the configured URL differs. */
  sourceUrl: LinkCodeMarketplaceHttpsUrlSchema,
  /** Preserved verbatim for the next `If-None-Match` request. */
  etag: z.string().min(1).optional(),
  /** Preserved verbatim for the next `If-Modified-Since` request. */
  lastModified: z.string().min(1).optional(),
  checkedAt: TimestampSchema,
  lastSuccessfulUpdateAt: TimestampSchema.optional(),
});
export type LinkCodeMarketplaceRefreshState = z.infer<typeof LinkCodeMarketplaceRefreshStateSchema>;
