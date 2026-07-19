const ROOT_PATH_RE = /^[\\/]+$/;
const PATH_SEPARATOR_RE = /[\\/]+/;
const WINDOWS_DRIVE_LABEL_RE = /^[a-z]:$/i;
const WINDOWS_DRIVE_ROOT_RE = /^[a-z]:[\\/]*$/i;

/** The trailing path segment of `cwd` — the fallback display label when no friendlier name exists. */
export function repositoryLabel(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return cwd;
  if (ROOT_PATH_RE.test(trimmed)) return trimmed[0] === '\\' ? '\\' : '/';

  const parts = trimmed.split(PATH_SEPARATOR_RE).filter(Boolean);
  const label = parts.at(-1);
  if (!label) return trimmed;
  if (WINDOWS_DRIVE_LABEL_RE.test(label) && WINDOWS_DRIVE_ROOT_RE.test(trimmed)) {
    return `${label}\\`;
  }
  return label;
}
