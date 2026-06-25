import type { HighlighterCore, ThemedToken } from 'shiki/core';

const SHIKI_THEME = 'github-dark';

const SHIKI_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'bash',
  'diff',
  'markdown',
  'css',
  'html',
  'yaml',
  'toml',
] as const;

type ShikiLanguage = (typeof SHIKI_LANGUAGES)[number];

export interface HighlightedToken {
  key: string;
  content: string;
  color?: string;
}

export interface HighlightedLine {
  key: string;
  tokens: HighlightedToken[];
}

export interface HighlightedCode {
  language: ShikiLanguage;
  lines: HighlightedLine[];
}

const SHIKI_LANGUAGE_SET = new Set<string>(SHIKI_LANGUAGES);

const LANGUAGE_ALIASES: Record<string, ShikiLanguage> = {
  cjs: 'javascript',
  htm: 'html',
  js: 'javascript',
  jsonc: 'json',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  shell: 'bash',
  sh: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
};

const highlightCache = new Map<string, Promise<HighlightedCode | null>>();
let highlighterPromise: Promise<Highlighter> | null = null;

type Highlighter = HighlighterCore;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createChatHighlighter();
  return highlighterPromise;
}

async function createChatHighlighter(): Promise<Highlighter> {
  const [
    { createHighlighterCore },
    { createOnigurumaEngine },
    wasm,
    githubDark,
    typescript,
    tsx,
    javascript,
    jsx,
    json,
    bash,
    diff,
    markdown,
    css,
    html,
    yaml,
    toml,
  ] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/oniguruma'),
    import('shiki/wasm'),
    import('shiki/themes/github-dark.mjs'),
    import('shiki/langs/typescript.mjs'),
    import('shiki/langs/tsx.mjs'),
    import('shiki/langs/javascript.mjs'),
    import('shiki/langs/jsx.mjs'),
    import('shiki/langs/json.mjs'),
    import('shiki/langs/bash.mjs'),
    import('shiki/langs/diff.mjs'),
    import('shiki/langs/markdown.mjs'),
    import('shiki/langs/css.mjs'),
    import('shiki/langs/html.mjs'),
    import('shiki/langs/yaml.mjs'),
    import('shiki/langs/toml.mjs'),
  ]);

  return createHighlighterCore({
    engine: createOnigurumaEngine(wasm.default),
    themes: [githubDark.default],
    langs: [
      typescript.default,
      tsx.default,
      javascript.default,
      jsx.default,
      json.default,
      bash.default,
      diff.default,
      markdown.default,
      css.default,
      html.default,
      yaml.default,
      toml.default,
    ],
  });
}

export function normalizeCodeLanguage(language: string | undefined): ShikiLanguage | null {
  if (!language) return null;
  const normalized = language
    .trim()
    .toLowerCase()
    .replace(/^language-/, '');
  if (!normalized || normalized === 'text' || normalized === 'plaintext') return null;
  if (SHIKI_LANGUAGE_SET.has(normalized)) return normalized as ShikiLanguage;
  return LANGUAGE_ALIASES[normalized] ?? null;
}

export function highlightCode(
  code: string,
  language: string | undefined,
): Promise<HighlightedCode | null> {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (!normalizedLanguage || code.length === 0) return Promise.resolve(null);

  const cacheKey = `${normalizedLanguage}\0${code}`;
  const cached = highlightCache.get(cacheKey);
  if (cached) return cached;

  const highlighted = getHighlighter()
    .then((highlighter) =>
      highlighter.codeToTokens(code, {
        lang: normalizedLanguage,
        theme: SHIKI_THEME,
      }),
    )
    .then((result) => ({
      language: normalizedLanguage,
      lines: result.tokens.map((line, lineIndex) => ({
        key: `line-${lineIndex}`,
        tokens: line.map((token, tokenIndex) => tokenFromShiki(token, lineIndex, tokenIndex)),
      })),
    }))
    .catch(() => null);

  highlightCache.set(cacheKey, highlighted);
  return highlighted;
}

function tokenFromShiki(
  token: ThemedToken,
  lineIndex: number,
  tokenIndex: number,
): HighlightedToken {
  return {
    key: `token-${lineIndex}-${tokenIndex}`,
    content: token.content,
    color: token.color,
  };
}
