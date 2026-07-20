import { createContext, useContext } from 'react';
import type { CodeThemePair } from './code-themes';
import { DEFAULT_CODE_THEME } from './code-themes';

/** Renderer preferences the host (workbench) sources from the appearance store. CSS-driven motion
 * is handled globally via the `.reduce-motion` root class; only values a component must branch on
 * flow through this context. The default keeps standalone UI working. */
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
