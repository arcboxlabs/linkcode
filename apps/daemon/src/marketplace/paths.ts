import { join } from 'node:path';
import { daemonStateDir } from '../paths';

/** Per-universe marketplace cache root: `<state dir>/marketplaces`. Resolved per call so a fake
 * `$HOME` redirects it, the same property that isolates an E2E daemon. */
export function marketplacesRoot(): string {
  return join(daemonStateDir(), 'marketplaces');
}

/** The last successfully parsed index for one marketplace; installs resolve from it. */
export function marketplaceIndexCachePath(marketplaceId: string): string {
  return join(marketplacesRoot(), `${marketplaceId}.index.json`);
}

/** Mutable HTTP validators (ETag/Last-Modified), stored apart from the cached index. */
export function marketplaceRefreshStatePath(marketplaceId: string): string {
  return join(marketplacesRoot(), `${marketplaceId}.refresh.json`);
}
