/** Host-routed preview namespace shared by the reverse proxy (transport) and the script runner
 * (engine). Hostnames are `<label>--<label>.localhost`; the `--` and `.localhost` suffix mark the
 * namespace, so an unrouted preview-looking Host 404s without reaching the daemon API (CODE-58). */

/** Either an upstream dev server to proxy to, daemon-held content served directly
 * (ephemeral artifact hosting — CODE-62), or an on-disk file streamed with HTTP Range
 * support (workspace media previews — CODE-316). */
export type PreviewRoute =
  | {
      /** Loopback port of the upstream dev server. */
      port: number;
    }
  | {
      /** Response body served verbatim for every path under the hostname. */
      body: string;
      contentType: string;
    }
  | {
      /** Absolute path of an on-disk file streamed for every path under the hostname,
       * honoring the request's `Range` header so large media seeks without a full download. */
      filePath: string;
      contentType: string;
    };

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

/** Whether an Origin header value belongs to the preview namespace (used to keep
 * preview/artifact pages from talking to the daemon's own endpoints — CORS denial). */
export function isPreviewOrigin(origin: string): boolean {
  try {
    return isPreviewHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}
