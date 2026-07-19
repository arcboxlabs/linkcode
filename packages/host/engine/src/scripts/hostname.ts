import { createHash } from 'node:crypto';
import { normalizeCwdKey } from '@linkcode/schema';

/**
 * Preview hostname for a service: `<script>--<workspace>-<hash6>.localhost`. The single `--` is
 * the proxy's namespace marker (see transport/preview-routes); the cwd hash keeps two same-named
 * workspaces from colliding.
 */
export function scriptHostname(scriptName: string, workspaceName: string, cwd: string): string {
  const script = slugify(scriptName);
  const workspace = slugify(workspaceName);
  const hash = createHash('sha256').update(normalizeCwdKey(cwd)).digest('hex').slice(0, 6);
  return `${script}--${workspace}-${hash}.localhost`;
}

/** Lowercased `[a-z0-9-]` label; runs of anything else collapse to one dash. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  // A label made entirely of separators still needs to be a valid DNS label.
  return slug.length > 0 ? slug.slice(0, 40) : 'x';
}
