import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchWithSystemProxy } from '@linkcode/assets';
import type { LinkCodeMarketplaceService, MarketplaceRefreshResult } from '@linkcode/engine';
import type {
  LinkCodeMarketplaceConfigList,
  LinkCodeMarketplaceIndexReader,
  LinkCodeMarketplaceRefreshState,
  LinkCodeMarketplaceReleaseIdentity,
  LinkCodePluginRelease,
} from '@linkcode/schema';
import {
  LinkCodeMarketplaceIndexReaderSchema,
  LinkCodeMarketplaceRefreshStateSchema,
} from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { logger } from '../logger';
import { marketplaceIndexCachePath, marketplaceRefreshStatePath } from './paths';

/** The fetch surface the refresh flow needs; injectable so tests never touch the network. */
export interface MarketplaceIndexResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type MarketplaceFetch = (
  url: string,
  options: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<MarketplaceIndexResponse>;

const ABSOLUTE_HTTP_URL_RE = /^https?:\/\//i;
const REFRESH_TIMEOUT_MS = 30000;

/**
 * Daemon-backed marketplace plane: refreshes each configured HTTPS index with its cached ETag /
 * Last-Modified validators (304 reuses the cached catalog), persists the parsed index and the
 * refresh state per marketplace id, and resolves install identities from the cache — installs
 * never re-fetch the index. Artifact mirrors relative to the index resolve against the source URL
 * per RFC 3986.
 */
export class DaemonLinkCodeMarketplaceService implements LinkCodeMarketplaceService {
  constructor(
    private readonly marketplaces: LinkCodeMarketplaceConfigList,
    private readonly fetchIndex: MarketplaceFetch = (url, options) =>
      fetchWithSystemProxy(url, options),
  ) {}

  list(): LinkCodeMarketplaceConfigList {
    return this.marketplaces;
  }

  async refresh(marketplaceId: string): Promise<MarketplaceRefreshResult> {
    return this.refreshIndex(marketplaceId, false);
  }

  private async refreshIndex(
    marketplaceId: string,
    retriedWithoutValidators: boolean,
  ): Promise<MarketplaceRefreshResult> {
    const config = nullthrow(
      this.marketplaces.find((entry) => entry.id === marketplaceId),
      `Unknown marketplace: ${marketplaceId}`,
    );
    if (!config.enabled) throw new Error(`Marketplace is disabled: ${marketplaceId}`);
    const url = config.source.url;
    // Validators are only replayed against the exact URL that produced them.
    const state = readRefreshState(marketplaceId);
    const validators = state?.sourceUrl === url ? state : undefined;
    const headers: Record<string, string> = {};
    if (validators?.etag !== undefined) headers['if-none-match'] = validators.etag;
    if (validators?.lastModified !== undefined) {
      headers['if-modified-since'] = validators.lastModified;
    }
    const response = await this.fetchIndex(url, {
      headers,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (response.status === 304) {
      const cachedIndex = readIndexCache(marketplaceId);
      if (cachedIndex === undefined) {
        if (retriedWithoutValidators) {
          throw new Error('Marketplace returned HTTP 304 without a usable cached index');
        }
        // A validator is only meaningful alongside the index it validates. If local state was
        // deleted or corrupted, remove it and retry once without conditional request headers.
        dropCachedIndexAndValidators(marketplaceId);
        logger.warn(
          { marketplaceId, operation: 'marketplace.refresh' },
          'Received HTTP 304 without a usable cached index; retrying unconditionally',
        );
        return this.refreshIndex(marketplaceId, true);
      }
      if (validators !== undefined) {
        writeRefreshState({ ...validators, checkedAt: Date.now() });
      }
      // A 304 means the remote index is unchanged, not that the catalog is empty. Reuse the
      // daemon's persisted index so clients can replace their snapshot safely even when they do not
      // retain the previous response in memory (for example after an uninstall or page remount).
      return {
        releases: flattenReleases(cachedIndex),
        notModified: true,
      };
    }
    if (!response.ok) {
      throw new Error(`Marketplace index request failed with HTTP ${response.status}`);
    }
    const index = parseIndex(await response.text());
    const now = Date.now();
    writeJsonAtomic(marketplaceIndexCachePath(marketplaceId), index);
    writeRefreshState({
      marketplaceId,
      sourceUrl: url,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      checkedAt: now,
      lastSuccessfulUpdateAt: now,
    });
    return { releases: flattenReleases(index) };
  }

  resolveRelease(identity: LinkCodeMarketplaceReleaseIdentity): LinkCodePluginRelease | undefined {
    const config = this.marketplaces.find((entry) => entry.id === identity.marketplaceId);
    const index = readIndexCache(identity.marketplaceId);
    if (index === undefined || !config?.enabled) return undefined;
    const plugin = index.plugins.find((entry) => entry.id === identity.pluginId);
    const release = plugin?.releases.find(
      (candidate) => candidate.manifest.version === identity.version,
    );
    if (release === undefined) return undefined;
    return {
      ...release,
      artifact: {
        ...release.artifact,
        urls: release.artifact.urls.map((url) => resolveMirrorUrl(url, config.source.url)),
      },
    };
  }
}

function dropCachedIndexAndValidators(marketplaceId: string): void {
  rmSync(marketplaceIndexCachePath(marketplaceId), { force: true });
  rmSync(marketplaceRefreshStatePath(marketplaceId), { force: true });
}

function resolveMirrorUrl(url: string, indexUrl: string): string {
  if (ABSOLUTE_HTTP_URL_RE.test(url)) return url;
  return new URL(url, indexUrl).href;
}

function parseIndex(body: string): LinkCodeMarketplaceIndexReader {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (error) {
    throw new Error('Marketplace index is not valid JSON', { cause: error });
  }
  const result = LinkCodeMarketplaceIndexReaderSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Marketplace index failed validation: ${result.error.issues[0]?.message ?? 'unknown'}`,
      { cause: result.error },
    );
  }
  return result.data;
}

function flattenReleases(
  index: LinkCodeMarketplaceIndexReader,
): MarketplaceRefreshResult['releases'] {
  return index.plugins.flatMap((plugin) =>
    plugin.releases.map((release) => ({ pluginId: plugin.id, release })),
  );
}

function readRefreshState(marketplaceId: string): LinkCodeMarketplaceRefreshState | undefined {
  const raw = readJson(marketplaceRefreshStatePath(marketplaceId));
  if (raw === undefined) return undefined;
  const result = LinkCodeMarketplaceRefreshStateSchema.safeParse(raw);
  if (!result.success) {
    logger.warn(
      { marketplaceId, operation: 'marketplace.refresh-state' },
      'Dropping invalid refresh state',
    );
    return undefined;
  }
  return result.data;
}

function writeRefreshState(state: LinkCodeMarketplaceRefreshState): void {
  writeJsonAtomic(marketplaceRefreshStatePath(state.marketplaceId), state);
}

function readIndexCache(marketplaceId: string): LinkCodeMarketplaceIndexReader | undefined {
  const raw = readJson(marketplaceIndexCachePath(marketplaceId));
  if (raw === undefined) return undefined;
  const result = LinkCodeMarketplaceIndexReaderSchema.safeParse(raw);
  if (!result.success) {
    logger.warn(
      { marketplaceId, operation: 'marketplace.index-cache' },
      'Dropping invalid cached marketplace index',
    );
    return undefined;
  }
  return result.data;
}

function readJson(path: string): unknown {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`);
  try {
    const descriptor = openSync(tmp, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
      chmodSync(tmp, 0o600);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
