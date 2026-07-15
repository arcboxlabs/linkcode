import { zodPersist } from '@linkcode/common/zustand';
import type { TerminalColorScheme, TerminalFontFamily } from '@linkcode/ui';
import {
  DEFAULT_TERMINAL_COLOR_SCHEME,
  DEFAULT_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_COLOR_SCHEMES,
  TERMINAL_FONT_FAMILIES,
} from '@linkcode/ui';
import { z } from 'zod';
import { create } from 'zustand';

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedTerminalPrefsSchema = z
  .object({
    fontFamily: z.enum(TERMINAL_FONT_FAMILIES),
    fontSize: z.number().int().min(8).max(32),
    colorScheme: z.enum(TERMINAL_COLOR_SCHEMES),
  })
  .partial();
type PersistedTerminalPrefs = z.infer<typeof PersistedTerminalPrefsSchema>;

/**
 * Shared interactive-terminal appearance — persisted per renderer, never sent to the daemon. Pure
 * client render knobs both desktop and webview surface (the live terminal itself is desktop-only,
 * but webview persists the same prefs for parity).
 */
export interface TerminalPrefsState {
  fontFamily: TerminalFontFamily;
  /** Font size in CSS pixels. */
  fontSize: number;
  /** `'auto'` follows the app light/dark mode; a named restty theme applies regardless. */
  colorScheme: TerminalColorScheme;
  setFontFamily: (fontFamily: TerminalFontFamily) => void;
  setFontSize: (fontSize: number) => void;
  setColorScheme: (colorScheme: TerminalColorScheme) => void;
}

export const useTerminalPrefsStore = create<TerminalPrefsState>()(
  zodPersist<TerminalPrefsState, [], [], PersistedTerminalPrefs, PersistedTerminalPrefs>(
    (set) => ({
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE,
      colorScheme: DEFAULT_TERMINAL_COLOR_SCHEME,
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontSize: (fontSize) => set({ fontSize }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
    }),
    {
      name: 'linkcode.workbench.terminal-prefs:v1',
      schema: PersistedTerminalPrefsSchema,
      partialize: (state) => ({
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        colorScheme: state.colorScheme,
      }),
    },
  ),
);
