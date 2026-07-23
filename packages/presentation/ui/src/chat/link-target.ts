import { hasKnownFileIdentity } from '../lib/file-icon';
import { fileBasename } from './artifacts/file-kind';

/** A chat link target, classified for icon and interaction dispatch. Mention links come from
 * agent output as `[label](target)`: `plugin://<id>`, absolute skill/file paths with an
 * optional `:line` / `:line:column` suffix, and plain web URLs. Wire resource URIs
 * additionally classify `file://` as files and unknown schemes as generic `uri` targets. */
export type LinkTarget =
  | { kind: 'web'; href: string; hostname: string }
  | { kind: 'plugin'; id: string }
  | { kind: 'skill'; path: string }
  | { kind: 'file'; path: string; line?: number }
  | { kind: 'uri'; uri: string };

const PLUGIN_PREFIX = 'plugin://';
const WEB_HREF_RE = /^https?:\/\//i;
const LINE_SUFFIX_RE = /:(\d+)(?::\d+)?$/;
const SKILL_BASENAME = 'SKILL.md';

/** mdast percent-encodes link destinations (spaces, CJK); compare paths decoded. */
function decodedPath(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

function pathTarget(decoded: string): LinkTarget {
  const lineMatch = LINE_SUFFIX_RE.exec(decoded);
  const path = lineMatch === null ? decoded : decoded.slice(0, lineMatch.index);
  if (fileBasename(path) === SKILL_BASENAME) return { kind: 'skill', path };
  if (lineMatch === null) return { kind: 'file', path };
  return { kind: 'file', path, line: Number(lineMatch[1]) };
}

/** Classify a markdown link href. Null → not ours (fragments, mailto, bare relative URLs);
 * callers keep their default anchor behavior. `./`-prefixed destinations are unambiguously
 * workspace files — the composer serializes mentions that way — while bare relative hrefs
 * stay untouched. */
export function linkTargetFor(href: string | null | undefined): LinkTarget | null {
  if (!href || href[0] === '#') return null;
  if (href.startsWith(PLUGIN_PREFIX)) {
    const id = href.slice(PLUGIN_PREFIX.length);
    return id.length === 0 ? null : { kind: 'plugin', id };
  }
  if (WEB_HREF_RE.test(href)) {
    try {
      return { kind: 'web', href, hostname: new URL(href).hostname };
    } catch {
      return null;
    }
  }
  if (href.startsWith('./') || href.startsWith('../')) {
    const decoded = decodedPath(href);
    return pathTarget(decoded.startsWith('./') ? decoded.slice(2) : decoded);
  }
  // ponytail: POSIX absolute paths only — Windows drive hrefs (C:\…) never reach here, the
  // markdown sanitizer already drops their unknown single-letter protocol.
  if (href[0] === '/') return pathTarget(decodedPath(href));
  // Bare relative destinations ([x](package-lock.json)) are how agents commonly reference
  // files; as anchors they only 404 against the app origin, so evidence-based file
  // classification is strictly better. The charset test also rejects schemes (mailto:…).
  return filePathTarget(decodedPath(href));
}

const MAX_INLINE_PATH_LENGTH = 256;
/** One path-safe token, optionally `./`/`../`-anchored or absolute, with an optional trailing
 * `:line` / `:line:column`. A colon anywhere else (schemes, prose) fails the shape. */
const INLINE_PATH_RE = /^(?:\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*(?::\d+(?::\d+)?)?$/;

/** Classify a bare token (inline-code span, bare relative href) as a workspace file, or null.
 * Shape alone is not enough — `origin/main` and `foo.bar` read like paths — so the token must
 * also carry a file identity the icon system recognizes (known extension, filename, dotfile). */
export function filePathTarget(text: string): LinkTarget | null {
  const candidate = text.trim();
  if (candidate.length === 0 || candidate.length > MAX_INLINE_PATH_LENGTH) return null;
  if (!INLINE_PATH_RE.test(candidate)) return null;
  const target = pathTarget(candidate.startsWith('./') ? candidate.slice(2) : candidate);
  if (target.kind !== 'file' && target.kind !== 'skill') return null;
  return hasKnownFileIdentity(target.path) ? target : null;
}

const FILE_URI_PREFIX = 'file://';

/** Classify a wire resource URI (MCP `resource_link`). Total: `file://` maps onto the file
 * classification and unknown schemes fall back to a generic `uri` target instead of null,
 * so every resource link renders a chip. */
export function linkTargetForUri(uri: string): LinkTarget {
  const fromHref = linkTargetFor(uri);
  if (fromHref !== null) return fromHref;
  if (uri.startsWith(FILE_URI_PREFIX)) {
    try {
      return pathTarget(decodedPath(new URL(uri).pathname));
    } catch {
      return { kind: 'uri', uri };
    }
  }
  return { kind: 'uri', uri };
}

/** Google's s2 endpoint resolves a favicon for any registrable domain and always answers with
 * an image (a generic globe when the site has none), so the `<img>` error path stays cold. */
export function faviconSrcFor(hostname: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
}
