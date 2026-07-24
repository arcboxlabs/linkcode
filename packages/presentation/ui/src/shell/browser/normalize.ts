/** Loopback-ish authorities (localhost and subdomains — the preview proxy's
 * `*.localhost` hostnames — plus bare IPv4/IPv6) default to http; the web defaults to https. */
const LOOPBACK_AUTHORITY_RE =
  /^(?:(?:[\w-]+\.)*localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\d.:a-f]+\])(?::\d+)?(?:[#/?]|$)/i;
const LOCALHOST_SUFFIX = '.localhost';
const PREVIEW_LABEL_RE = /^[a-z0-9-]+$/;
const SCHEME_RE = /^[a-z][\d+.a-z-]*:/i;

/** Address-bar input → navigable URL (paseo's normalization rules). */
export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (LOOPBACK_AUTHORITY_RE.test(trimmed)) return `http://${trimmed}`;
  if (SCHEME_RE.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

/** The in-app browser loads web content only. */
export function isAllowedBrowserUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Whether a URL belongs to the daemon's ephemeral `<kind>--<id>.localhost` preview namespace. */
export function isPreviewBrowserUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    if (!hostname.endsWith(LOCALHOST_SUFFIX)) return false;
    const label = hostname.slice(0, -LOCALHOST_SUFFIX.length);
    return label.includes('--') && PREVIEW_LABEL_RE.test(label);
  } catch {
    return false;
  }
}
