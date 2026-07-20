import type { HighlighterCore, ThemedToken } from '@shikijs/core';
import { createHighlighterCore } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import css from '@shikijs/langs/css';
import diff from '@shikijs/langs/diff';
import go from '@shikijs/langs/go';
import html from '@shikijs/langs/html';
import json from '@shikijs/langs/json';
import python from '@shikijs/langs/python';
import rust from '@shikijs/langs/rust';
import shellscript from '@shikijs/langs/shellscript';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import yaml from '@shikijs/langs/yaml';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';

// Hermes has no WASM, so highlighting runs shiki's JavaScript regex engine (validated on
// Hermes 0.17: no `v` flag support, which the engine's auto target detection routes around).
// The language set is static — Metro cannot bundle dynamic grammar imports — and this whole
// module is loaded lazily (dynamic import) the first time a fenced code block renders.
// tsx/typescript cover the js/jsx grammars via embedded scopes well enough for chat output.
const LANG_ALIASES: Record<string, string> = {
  js: 'typescript',
  javascript: 'typescript',
  jsx: 'tsx',
  ts: 'typescript',
  bash: 'shellscript',
  sh: 'shellscript',
  zsh: 'shellscript',
  py: 'python',
  yml: 'yaml',
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [css, diff, go, html, json, python, rust, shellscript, tsx, typescript, yaml],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

/** Tokenize `code`, or return null for unknown languages (caller falls back to plain mono). */
export async function highlightCode(
  code: string,
  lang: string,
  colorScheme: 'light' | 'dark',
): Promise<ThemedToken[][] | null> {
  const highlighter = await getHighlighter();
  const resolved = LANG_ALIASES[lang] ?? lang;
  if (!highlighter.getLoadedLanguages().includes(resolved)) return null;
  const { tokens } = highlighter.codeToTokens(code, {
    lang: resolved,
    theme: colorScheme === 'dark' ? 'github-dark' : 'github-light',
  });
  return tokens;
}
