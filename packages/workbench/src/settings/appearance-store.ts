import { zodPersist } from '@linkcode/common/zustand';
import type { CodeThemeDarkId, CodeThemeLightId } from '@linkcode/ui';
import { CODE_THEME_DARK_IDS, CODE_THEME_LIGHT_IDS } from '@linkcode/ui';
import { z } from 'zod';
import { create } from 'zustand';

export const TextSizeSchema = z.enum(['small', 'default', 'large']);
export type TextSize = z.infer<typeof TextSizeSchema>;

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedAppearanceSchema = z
  .object({
    textSize: TextSizeSchema,
    reduceMotion: z.boolean(),
    codeThemeLight: z.enum(CODE_THEME_LIGHT_IDS),
    codeThemeDark: z.enum(CODE_THEME_DARK_IDS),
  })
  .partial();
type PersistedAppearance = z.infer<typeof PersistedAppearanceSchema>;

/**
 * Shared renderer appearance preferences — persisted to each renderer's localStorage, never sent
 * to the daemon. Pure client-side rendering knobs both desktop and webview need, so they live here
 * rather than in the desktop-only main-process settings (theme/locale/daemonUrl). `theme` stays in
 * each app's own store because it is a system-plane value on desktop.
 */
export interface AppearancePrefsState {
  /** Root font scale applied to the whole UI. */
  textSize: TextSize;
  /** When on, the UI suppresses non-essential motion (transitions, spinners, the streaming shimmer). */
  reduceMotion: boolean;
  /** Shiki theme for chat code blocks under a light background. */
  codeThemeLight: CodeThemeLightId;
  /** Shiki theme for chat code blocks under a dark background. */
  codeThemeDark: CodeThemeDarkId;
  setTextSize: (textSize: TextSize) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setCodeThemeLight: (codeThemeLight: CodeThemeLightId) => void;
  setCodeThemeDark: (codeThemeDark: CodeThemeDarkId) => void;
}

export const useAppearancePrefsStore = create<AppearancePrefsState>()(
  zodPersist<AppearancePrefsState, [], [], PersistedAppearance, PersistedAppearance>(
    (set) => ({
      textSize: 'default',
      reduceMotion: false,
      codeThemeLight: 'github-light',
      codeThemeDark: 'github-dark',
      setTextSize: (textSize) => set({ textSize }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setCodeThemeLight: (codeThemeLight) => set({ codeThemeLight }),
      setCodeThemeDark: (codeThemeDark) => set({ codeThemeDark }),
    }),
    {
      name: 'linkcode.workbench.appearance:v1',
      schema: PersistedAppearanceSchema,
      partialize: (state) => ({
        textSize: state.textSize,
        reduceMotion: state.reduceMotion,
        codeThemeLight: state.codeThemeLight,
        codeThemeDark: state.codeThemeDark,
      }),
    },
  ),
);
