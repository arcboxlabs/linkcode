import { createContext, useContext } from 'react';

/**
 * Renderer preferences that presentation components read directly. Only motion belongs here today:
 * CSS-driven motion is handled globally by the `.reduce-motion` root class, but JS-driven motion
 * (the framer `Shimmer`) has to branch on the value, so it flows through this context. The host
 * (workbench) provides it from the shared appearance store; the default keeps standalone UI working.
 */
export interface RenderPrefs {
  /** When true, skip non-essential JS-driven motion. */
  reduceMotion: boolean;
}

const DEFAULT_RENDER_PREFS: RenderPrefs = { reduceMotion: false };

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
