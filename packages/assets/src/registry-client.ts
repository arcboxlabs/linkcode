import { extractErrorMessage } from 'foxts/extract-error-message';
import { z } from 'zod';
import { DownloadError } from './errors';

/** Default ordered registry list; a mirror (e.g. npmmirror for CN hosts) can be appended later. */
const DEFAULT_REGISTRIES = ['https://registry.npmjs.org'] as const;

const MANIFEST_TIMEOUT_MS = 10000;

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

/**
 * Resolve a package version's tarball URL + SRI integrity via the single-version manifest
 * (`<registry>/<pkg>/<version>` — a few hundred bytes; the full packument for the agent CLIs
 * runs to megabytes). Scoped names go in the path unencoded; the registry accepts them.
 * Registries are an ordered fallback list: the first one that answers wins.
 */
export async function fetchNpmDist(
  pkg: string,
  version: string,
  registries: readonly string[] = DEFAULT_REGISTRIES,
): Promise<NpmDist> {
  const failures: string[] = [];
  for (const registry of registries) {
    // eslint-disable-next-line no-await-in-loop -- registries are an ordered fallback list
    const dist = await fetchDist(`${registry}/${pkg}/${version}`, failures);
    if (dist) return dist;
  }
  throw new DownloadError(`no registry answered for ${pkg}@${version}: ${failures.join('; ')}`);
}

async function fetchDist(url: string, failures: string[]): Promise<NpmDist | undefined> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
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
