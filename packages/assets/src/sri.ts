import { IntegrityError } from './errors';

/** Digest algorithms we can verify, strongest first — multi-hash SRI resolves to the strongest. */
const SUPPORTED_ALGORITHMS = ['sha512', 'sha384', 'sha256'] as const;

const WHITESPACE = /\s+/;
export type SriAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

export interface SriDigest {
  algorithm: SriAlgorithm;
  /** Base64 digest exactly as it appears in the SRI string. */
  digest: string;
}

/**
 * Pick the strongest supported digest out of an SRI string (`sha512-<base64>`, possibly
 * whitespace-separated multi-hash, optionally `?option`-suffixed — the W3C SRI grammar).
 * Base64 never contains `-`, so splitting each entry at its first `-` is unambiguous.
 * Throws when nothing usable remains: an artifact we cannot verify must never install.
 */
export function strongestSriDigest(integrity: string): SriDigest {
  const entries = integrity.split(WHITESPACE).filter(Boolean);
  for (const algorithm of SUPPORTED_ALGORITHMS) {
    const prefix = `${algorithm}-`;
    const entry = entries.find((candidate) => candidate.startsWith(prefix));
    if (!entry) continue;
    const digest = entry.slice(prefix.length).split('?', 1)[0];
    if (digest) return { algorithm, digest };
  }
  throw new IntegrityError(`no supported digest in integrity string "${integrity}"`);
}
