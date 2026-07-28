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
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  ogv: 'video',
};

export function fileExtension(path: string): string {
  const base = fileBasename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function fileBasename(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash === -1 ? path : path.slice(slash + 1);
}

/** The panel-capable artifact kind for a file path, or null when nothing can view it. Only a
 * capability hint for the viewer's renderer switch and video routing — never a chip gate:
 * unknown utf8 kinds fall back to the viewer's code renderer (`filePathTarget` classifies). */
export function artifactKindForPath(path: string): string | null {
  return KIND_BY_EXTENSION[fileExtension(path)] ?? null;
}
