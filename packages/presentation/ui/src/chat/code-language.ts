import { fileExtension } from './artifacts/file-kind';

const LANGUAGE_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'application/javascript': 'javascript',
  'application/json': 'json',
  'application/typescript': 'typescript',
  'application/xhtml+xml': 'html',
  'application/xml': 'xml',
  'application/x-sh': 'shellscript',
  'application/yaml': 'yaml',
  'text/css': 'css',
  'text/html': 'html',
  'text/javascript': 'javascript',
  'text/jsx': 'jsx',
  'text/markdown': 'markdown',
  'text/typescript': 'typescript',
  'text/tsx': 'tsx',
  'text/xml': 'xml',
  'text/yaml': 'yaml',
};

const RE_URI_SUFFIX = /[?#]/;

/** Best-effort language hint for an embedded text resource. MIME wins because URIs may be opaque. */
export function codeLanguageForResource(uri: string, mimeType?: string): string | undefined {
  const normalizedMime = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (normalizedMime) {
    const mimeLanguage = LANGUAGE_BY_MIME_TYPE[normalizedMime];
    if (mimeLanguage) return mimeLanguage;
  }

  const suffixStart = uri.search(RE_URI_SUFFIX);
  const path = suffixStart === -1 ? uri : uri.slice(0, suffixStart);
  return fileExtension(path) || undefined;
}
