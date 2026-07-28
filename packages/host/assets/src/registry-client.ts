import { extractErrorMessage } from 'foxts/extract-error-message';
import { z } from 'zod';
import { DownloadError } from './errors';
import { fetchWithSystemProxy } from './system-proxy';

/** Default ordered registry list; a mirror (e.g. npmmirror for CN hosts) can be appended later. */
const DEFAULT_REGISTRIES = ['https://registry.npmjs.org'] as const;

const MANIFEST_TIMEOUT_MS = 10000;
const DEFAULT_RETRY = 2;

/** The slice of an npm single-version manifest we consume. */
const NpmVersionManifestSchema = z.object({
  dist: z.object({
    tarball: z.string().min(1),
    integrity: z.string().min(1),
  }),
});

export interface NpmDist {
  tarball: string;
  integrity: string;
}

export interface FetchNpmDistOptions {
  registries?: readonly string[];
  /** Per-registry retry count (network/5xx; 4xx fails fast to the next registry). */
  retry?: number;
}

/**
 * Resolve a package version's tarball URL + SRI integrity via the single-version manifest
 * (`<registry>/<pkg>/<version>`; the full packument runs to megabytes). Scoped names go in
 * the path unencoded. Registries are an ordered fallback list — the first answer wins.
 * Fetching goes through make-fetch-happen (retry + proxy env support, plus the OS-configured
 * system proxy when the env names none — `system-proxy.ts`).
 */
export async function fetchNpmDist(
  pkg: string,
  version: string,
  options: FetchNpmDistOptions = {},
): Promise<NpmDist> {
  const registries = options.registries ?? DEFAULT_REGISTRIES;
  const retry = options.retry ?? DEFAULT_RETRY;
  const failures: string[] = [];
  for (const registry of registries) {
    // eslint-disable-next-line no-await-in-loop -- registries are an ordered fallback list
    const dist = await fetchDist(`${registry}/${pkg}/${version}`, retry, failures);
    if (dist) return dist;
  }
  throw new DownloadError(`no registry answered for ${pkg}@${version}: ${failures.join('; ')}`);
}

async function fetchDist(
  url: string,
  retry: number,
  failures: string[],
): Promise<NpmDist | undefined> {
  try {
    const res = await fetchWithSystemProxy(url, {
      headers: { accept: 'application/json' },
      retry,
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      failures.push(`${url} -> HTTP ${res.status}`);
      return undefined;
    }
    const parsed = NpmVersionManifestSchema.safeParse(await res.json());
    if (!parsed.success) {
      failures.push(`${url} -> malformed version manifest`);
      return undefined;
    }
    return parsed.data.dist;
  } catch (error) {
    failures.push(`${url} -> ${extractErrorMessage(error)}`);
    return undefined;
  }
}
