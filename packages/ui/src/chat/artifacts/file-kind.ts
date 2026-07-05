/** Path → artifact kind mapping shared by the chat file cards and the panel viewer. */
const KIND_BY_EXTENSION: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  txt: 'text',
  json: 'text',
};

export function fileExtension(path: string): string {
  const base = fileBasename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function fileBasename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** The panel-capable artifact kind for a file path, or null when nothing can view it. */
export function artifactKindForPath(path: string): string | null {
  return KIND_BY_EXTENSION[fileExtension(path)] ?? null;
}

const MAX_INLINE_PATH_LENGTH = 256;
const INLINE_PATH_RE = /^(?:\.{1,2}\/|\/)?[\w.@+-]+(?:\/[\w.@+-]+)*$/;

/**
 * Decide whether an inline-code span is a workspace file path worth linking. Deliberately
 * conservative: single token, path-safe characters only, and an extension one of the
 * viewers understands — a stray `foo.bar` identifier stays plain code.
 */
export function detectInlineFilePath(text: string): string | null {
  const candidate = text.trim();
  if (candidate.length === 0 || candidate.length > MAX_INLINE_PATH_LENGTH) return null;
  if (!INLINE_PATH_RE.test(candidate)) return null;
  if (artifactKindForPath(candidate) === null) return null;
  return candidate;
}
