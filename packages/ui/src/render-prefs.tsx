import { createContext, useContext } from 'react';
import type { CodeThemePair } from './code-themes';
import { DEFAULT_CODE_THEME } from './code-themes';

/**
 * Renderer preferences that presentation components read directly, sourced from the shared
 * appearance store by the host (workbench). CSS-driven motion is handled globally by the
 * `.reduce-motion` root class, but values that a component must branch on — JS-driven motion (the
 * framer `Shimmer`) and the code-block theme (`Markdown`) — flow through this context. The default
 * keeps standalone UI working.
 */
export interface RenderPrefs {
  /** When true, skip non-essential JS-driven motion. */
  reduceMotion: boolean;
  /** [light, dark] shiki themes for chat code blocks. */
  codeTheme: CodeThemePair;
}

const DEFAULT_RENDER_PREFS: RenderPrefs = {
  reduceMotion: false,
  codeTheme: DEFAULT_CODE_THEME,
};

const RenderPrefsContext = createContext<RenderPrefs>(DEFAULT_RENDER_PREFS);

export function RenderPrefsProvider({
  prefs,
  children,
}: {
  prefs: RenderPrefs;
  children: React.ReactNode;
}): React.ReactNode {
  return <RenderPrefsContext.Provider value={prefs}>{children}</RenderPrefsContext.Provider>;
}

export function useRenderPrefs(): RenderPrefs {
  return useContext(RenderPrefsContext);
}
