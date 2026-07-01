import type { GitRemoteIdentity } from '@linkcode/schema';

/**
 * Hosts that resolve to a hosting provider. Only github.com is served today; adding GitLab/Bitbucket
 * (or self-hosted instances via config) starts by extending this map — the schema vocabulary and the
 * provider seam ({@link import('./provider').GitProviderClient}) are already in place.
 */
const PROVIDER_BY_HOST: Record<string, GitRemoteIdentity['provider']> = {
  'github.com': 'github',
  'ssh.github.com': 'github',
};

/**
 * Parse a git remote URL — scp-like (`git@host:owner/repo.git`), `ssh://`, `git://`, or `http(s)://`
 * — into a provider identity. Returns null when the host is not a supported provider or the path is
 * not exactly `owner/repo`.
 */
export function parseRemoteIdentity(url: string): GitRemoteIdentity | null {
  const location = parseRemoteLocation(url.trim());
  if (!location) return null;
  const provider = PROVIDER_BY_HOST[location.host];
  if (!provider) return null;

  const path = location.path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const segments = path.split('/');
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) return null;

  return { provider, host: location.host, owner: segments[0], repo: segments[1] };
}

// scp-like syntax has no scheme: user@host:path
const SCP_LIKE_REMOTE = /^[^@/]+@([^:/]+):(.+)$/;

const REMOTE_PROTOCOLS = new Set(['https:', 'http:', 'ssh:', 'git:']);

function parseRemoteLocation(url: string): { host: string; path: string } | null {
  const scpLike = SCP_LIKE_REMOTE.exec(url);
  if (scpLike) return { host: scpLike[1].toLowerCase(), path: scpLike[2] };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!REMOTE_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.hostname.length === 0) return null;
  return { host: parsed.hostname.toLowerCase(), path: parsed.pathname };
}
