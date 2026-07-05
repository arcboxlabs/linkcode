/**
 * Host-routed preview namespace shared by the reverse proxy (transport) and the script
 * runner (engine). Preview hostnames are `<label>--<label>.localhost`; the `--` and the
 * `.localhost` suffix mark the namespace, so an unrouted preview-looking Host can 404
 * without ever reaching the daemon API (the auth-exemption boundary decided in CODE-58).
 */

export interface PreviewRoute {
  /** Loopback port of the upstream dev server. */
  port: number;
}

/** The proxy's view of the route table; the engine's registry implements it. */
export interface PreviewRouteTable {
  lookup: (hostname: string) => PreviewRoute | null;
}

const LOCALHOST_SUFFIX = '.localhost';
const PREVIEW_LABEL_RE = /^[a-z0-9-]+$/;

/** Lower-cased hostname without the port, or null for absent/malformed Host headers. */
export function normalizeHostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.trim().toLowerCase();
  // IPv6 literals ([::1]:port) are never preview hosts.
  if (host[0] === '[') return null;
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

export function isPreviewHostname(hostname: string): boolean {
  if (!hostname.endsWith(LOCALHOST_SUFFIX)) return false;
  const label = hostname.slice(0, -LOCALHOST_SUFFIX.length);
  return label.includes('--') && PREVIEW_LABEL_RE.test(label);
}
