import { z } from 'zod';
import {
  LinkCodeMarketplaceConfigSchema,
  LinkCodeMarketplaceReleaseIdentitySchema,
} from '../model/linkcode-marketplace';
import {
  LinkCodeMarketplaceIdSchema,
  LinkCodePluginIdSchema,
  LinkCodePluginReleaseSchema,
  LinkCodePluginVersionSchema,
} from '../model/linkcode-plugin';
import { WireRequestIdSchema } from './request';

/** LinkCode marketplace wire variants. A marketplace is a user-configured HTTPS index; the daemon
 * refreshes it with ETag/If-None-Match and the client browses/releases and installs from the
 * returned catalog. The refresh reply carries the releases so a client never fetches the index
 * itself — the daemon is the only networked leg. */
export const pluginMarketWireVariants = [
  z.object({
    kind: z.literal('plugin-market.list.get'),
    clientReqId: WireRequestIdSchema,
  }),
  z.object({
    kind: z.literal('plugin-market.listed'),
    replyTo: WireRequestIdSchema,
    marketplaces: z.array(LinkCodeMarketplaceConfigSchema),
  }),
  z.object({
    kind: z.literal('plugin-market.refresh'),
    clientReqId: WireRequestIdSchema,
    marketplaceId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('plugin-market.refreshed'),
    replyTo: WireRequestIdSchema,
    marketplaceId: z.string().min(1),
    /** Releases the index advertised, already filtered to what this client can represent. */
    releases: z.array(
      z.object({
        pluginId: z.string().min(1),
        release: LinkCodePluginReleaseSchema,
      }),
    ),
    /** True when the index was unchanged (304 / matching ETag); releases is the cached catalog. */
    notModified: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('plugin-market.install'),
    clientReqId: WireRequestIdSchema,
    release: LinkCodeMarketplaceReleaseIdentitySchema,
  }),
  /** Success replies carry the installed identity so the client patches one cache entry instead of
   * re-listing; failures use the shared request.failed reply. */
  z.object({
    kind: z.literal('plugin-market.installed'),
    replyTo: WireRequestIdSchema,
    marketplaceId: LinkCodeMarketplaceIdSchema,
    pluginId: LinkCodePluginIdSchema,
    version: LinkCodePluginVersionSchema,
  }),
  z.object({
    kind: z.literal('plugin-market.uninstall'),
    clientReqId: WireRequestIdSchema,
    pluginId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('plugin-market.uninstalled'),
    replyTo: WireRequestIdSchema,
    pluginId: LinkCodePluginIdSchema,
  }),
] as const;
