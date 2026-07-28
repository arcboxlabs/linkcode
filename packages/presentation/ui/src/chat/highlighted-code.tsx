import type { HighlightResult } from '@streamdown/code';
import { createCodePlugin } from '@streamdown/code';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import type { BundledLanguage } from 'streamdown';
import { cn } from '../lib/cn';
import { useRenderPrefs } from '../render-prefs';

type HighlightToken = HighlightResult['tokens'][number][number];
type TokenStyle = React.CSSProperties & {
  '--sdm-c'?: string;
  '--sdm-tbg'?: string;
  '--shiki-dark'?: string;
  '--shiki-dark-bg'?: string;
};

interface HighlightedState {
  code: string;
  language: BundledLanguage;
  lightTheme: string;
  darkTheme: string;
  result: HighlightResult;
}

const languageProbe = createCodePlugin();

function supportedLanguage(language?: string): BundledLanguage | null {
  const candidate = language?.trim().toLowerCase();
  if (!candidate) return null;
  // The plugin normalizes its documented aliases (for example ts → typescript) internally.
  const bundledCandidate = candidate as BundledLanguage;
  return languageProbe.supportsLanguage(bundledCandidate) ? bundledCandidate : null;
}

function tokenPresentation(token: HighlightToken): {
  hasBackground: boolean;
  style: TokenStyle;
} {
  const style: TokenStyle = {};
  let hasBackground = Boolean(token.bgColor);
  if (token.color) style['--sdm-c'] = token.color;
  if (token.bgColor) style['--sdm-tbg'] = token.bgColor;
  if (token.htmlStyle) {
    const { color, 'background-color': backgroundColor, ...decoration } = token.htmlStyle;
    Object.assign(style, decoration);
    if (color) style['--sdm-c'] = color;
    if (backgroundColor) {
      style['--sdm-tbg'] = backgroundColor;
      hasBackground = true;
    }
  }
  return { hasBackground, style };
}

function HighlightedTokens({ result }: { result: HighlightResult }): React.ReactNode {
  return result.tokens.map((line, lineIndex) => (
    // eslint-disable-next-line @eslint-react/no-array-index-key -- Shiki exposes no line identity; the complete token tree is replaced as one result.
    <span key={lineIndex}>
      {line.map((token) => {
        const { hasBackground, style } = tokenPresentation(token);
        return (
          <span
            key={token.offset}
            {...token.htmlAttrs}
            className={cn(
              'text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]',
              hasBackground && 'bg-[var(--sdm-tbg)] dark:bg-[var(--shiki-dark-bg,var(--sdm-tbg))]',
            )}
            style={style}
          >
            {token.content}
          </span>
        );
      })}
      {lineIndex < result.tokens.length - 1 ? '\n' : null}
    </span>
  ));
}

/** Body-only code surface shared by cards that own their own header/chrome. */
export function HighlightedCode({
  code,
  language,
  className,
  ...props
}: Omit<React.ComponentProps<'pre'>, 'children'> & {
  code: string;
  language?: string;
}): React.ReactNode {
  const { codeTheme } = useRenderPrefs();
  const lightTheme = codeTheme[0];
  const darkTheme = codeTheme[1];
  const normalizedLanguage = supportedLanguage(language);
  const [highlighted, setHighlighted] = useState<HighlightedState | null>(null);

  useEffect(
    (signal) => {
      if (!normalizedLanguage) return;
      const themes = [lightTheme, darkTheme] as const;
      const plugin = createCodePlugin({ themes: [lightTheme, darkTheme] });
      const apply = (result: HighlightResult): void => {
        if (signal.aborted) return;
        // eslint-disable-next-line @eslint-react/set-state-in-effect, sukka/react-no-use-effect-watching -- Shiki resolves through this callback; the abort signal and tagged state reject stale results.
        setHighlighted({ code, language: normalizedLanguage, lightTheme, darkTheme, result });
      };
      const immediate = plugin.highlight(
        { code, language: normalizedLanguage, themes: [...themes] },
        apply,
      );
      if (immediate) apply(immediate);
    },
    [code, darkTheme, lightTheme, normalizedLanguage],
  );

  const current =
    highlighted?.code === code &&
    highlighted.language === normalizedLanguage &&
    highlighted.lightTheme === lightTheme &&
    highlighted.darkTheme === darkTheme
      ? highlighted.result
      : null;

  return (
    <pre
      className={cn('overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed', className)}
      data-language={language}
      {...props}
    >
      <code>{current ? <HighlightedTokens result={current} /> : code}</code>
    </pre>
  );
}
