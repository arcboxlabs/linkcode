import type {
  LinkCodeMarketplaceConfig,
  LinkCodeMarketplaceId,
  LinkCodeMarketplaceReleaseIdentity,
  LinkCodePluginId,
  LinkCodePluginRelease,
} from '@linkcode/schema';

/** One catalog row: a plugin id paired with a release its marketplace index advertised. */
export interface MarketplaceCatalogEntry {
  readonly pluginId: LinkCodePluginId;
  readonly release: LinkCodePluginRelease;
}

/** Result of one marketplace index refresh. */
export interface MarketplaceRefreshResult {
  /** Releases the index advertised, already filtered to what this build can represent. */
  readonly releases: readonly MarketplaceCatalogEntry[];
  /** True when the index was unchanged (304 / matching validators); releases is the cached catalog. */
  readonly notModified?: boolean;
}

/**
 * Daemon-owned marketplace plane: the configured marketplace list, an HTTP index refresh with
 * cached validators, and a network-free lookup over the last cached index. The daemon supplies the
 * persistent implementation; an absent Engine replies `unsupported` for refresh/install.
 */
export interface LinkCodeMarketplaceService {
  list(): LinkCodeMarketplaceConfig[];
  refresh(marketplaceId: LinkCodeMarketplaceId): Promise<MarketplaceRefreshResult>;
  /** Reads the cached index only — a refresh is what moves the catalog. */
  resolveRelease(identity: LinkCodeMarketplaceReleaseIdentity): LinkCodePluginRelease | undefined;
}
