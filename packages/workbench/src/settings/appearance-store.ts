import { zodPersist } from '@linkcode/common/zustand';
import type { CodeThemeDarkId, CodeThemeLightId } from '@linkcode/ui';
import { CODE_THEME_DARK_IDS, CODE_THEME_LIGHT_IDS } from '@linkcode/ui';
import { z } from 'zod';
import { create } from 'zustand';

export const TextSizeSchema = z.enum(['small', 'default', 'large']);
export type TextSize = z.infer<typeof TextSizeSchema>;

export const FilesTreeSideSchema = z.enum(['left', 'right']);
export type FilesTreeSide = z.infer<typeof FilesTreeSideSchema>;

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedAppearanceSchema = z
  .object({
    textSize: TextSizeSchema,
    reduceMotion: z.boolean(),
    codeThemeLight: z.enum(CODE_THEME_LIGHT_IDS),
    codeThemeDark: z.enum(CODE_THEME_DARK_IDS),
    uiFont: z.string(),
    codeFont: z.string(),
    filesTreeSide: FilesTreeSideSchema,
  })
  .partial();
type PersistedAppearance = z.infer<typeof PersistedAppearanceSchema>;

/**
 * Shared renderer appearance preferences — persisted per renderer in localStorage, never sent to
 * the daemon; both apps need them, so they cannot live in the desktop-only main-process settings.
 * `theme` stays in each app's own store because it is a system-plane value on desktop.
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
  /** Interface font family override (`--font-sans`); empty = the bundled sans stack. */
  uiFont: string;
  /** Monospace font family override (`--font-mono`, code blocks + inline code); empty = bundled. */
  codeFont: string;
  /** Which side of the Files panel the workspace tree docks to. */
  filesTreeSide: FilesTreeSide;
  setTextSize: (textSize: TextSize) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setCodeThemeLight: (codeThemeLight: CodeThemeLightId) => void;
  setCodeThemeDark: (codeThemeDark: CodeThemeDarkId) => void;
  setUiFont: (uiFont: string) => void;
  setCodeFont: (codeFont: string) => void;
  setFilesTreeSide: (filesTreeSide: FilesTreeSide) => void;
}

export const useAppearancePrefsStore = create<AppearancePrefsState>()(
  zodPersist<AppearancePrefsState, [], [], PersistedAppearance, PersistedAppearance>(
    (set) => ({
      textSize: 'default',
      reduceMotion: false,
      codeThemeLight: 'github-light',
      codeThemeDark: 'github-dark',
      uiFont: '',
      codeFont: '',
      filesTreeSide: 'right',
      setTextSize: (textSize) => set({ textSize }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setCodeThemeLight: (codeThemeLight) => set({ codeThemeLight }),
      setCodeThemeDark: (codeThemeDark) => set({ codeThemeDark }),
      setUiFont: (uiFont) => set({ uiFont }),
      setCodeFont: (codeFont) => set({ codeFont }),
      setFilesTreeSide: (filesTreeSide) => set({ filesTreeSide }),
    }),
    {
      name: 'linkcode.workbench.appearance:v1',
      schema: PersistedAppearanceSchema,
      partialize: (state) => ({
        textSize: state.textSize,
        reduceMotion: state.reduceMotion,
        codeThemeLight: state.codeThemeLight,
        codeThemeDark: state.codeThemeDark,
        uiFont: state.uiFont,
        codeFont: state.codeFont,
        filesTreeSide: state.filesTreeSide,
      }),
    },
  ),
);
