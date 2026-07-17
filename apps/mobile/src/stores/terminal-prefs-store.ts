import { zodPersist } from '@linkcode/common/zustand';
import type { TerminalTheme } from 'expo-libghostty';
import Storage from 'expo-sqlite/kv-store';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage } from 'zustand/middleware';
import { TERMINAL_THEME_NAMES, TERMINAL_THEMES } from '../constants/terminal-themes.generated';

export const TERMINAL_COLOR_SCHEMES = ['auto', ...TERMINAL_THEME_NAMES] as const;
export type TerminalColorScheme = (typeof TERMINAL_COLOR_SCHEMES)[number];

/** Grid font size in dp; the native default. Pinch-to-zoom steps from it. */
export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const TERMINAL_FONT_SIZES = [10, 12, 14, 16, 18, 20] as const;

/** Persisted subset — partial so stale/absent storage merges over defaults. */
const PersistedTerminalPrefsSchema = z
  .object({
    fontSize: z.number().int().min(8).max(32),
    colorScheme: z.enum(TERMINAL_COLOR_SCHEMES),
  })
  .partial();
type PersistedTerminalPrefs = z.infer<typeof PersistedTerminalPrefsSchema>;

export interface TerminalPrefsState {
  fontSize: number;
  colorScheme: TerminalColorScheme;
  setFontSize: (size: number) => void;
  setColorScheme: (scheme: TerminalColorScheme) => void;
}

/** Client-side terminal appearance; never sent to the daemon. */
export const useTerminalPrefsStore = create<TerminalPrefsState>()(
  zodPersist<TerminalPrefsState, [], [], PersistedTerminalPrefs, PersistedTerminalPrefs>(
    (set) => ({
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
      colorScheme: 'auto',
      setFontSize: (fontSize) => set({ fontSize }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
    }),
    {
      name: 'linkcode.mobile.terminal-prefs:v1',
      schema: PersistedTerminalPrefsSchema,
      storage: createJSONStorage(() => Storage),
      partialize: (state) => ({
        fontSize: state.fontSize,
        colorScheme: state.colorScheme,
      }),
    },
  ),
);

/** 'auto' keeps ghostty's defaults (undefined theme prop). */
export function resolveTerminalTheme(scheme: TerminalColorScheme): TerminalTheme | undefined {
  return scheme === 'auto' ? undefined : TERMINAL_THEMES[scheme];
}
