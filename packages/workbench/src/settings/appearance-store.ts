import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

export const TextSizeSchema = z.enum(['small', 'default', 'large']);
export type TextSize = z.infer<typeof TextSizeSchema>;

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedAppearanceSchema = z
  .object({
    textSize: TextSizeSchema,
    reduceMotion: z.boolean(),
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
  setTextSize: (textSize: TextSize) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
}

export const useAppearancePrefsStore = create<AppearancePrefsState>()(
  zodPersist<AppearancePrefsState, [], [], PersistedAppearance, PersistedAppearance>(
    (set) => ({
      textSize: 'default',
      reduceMotion: false,
      setTextSize: (textSize) => set({ textSize }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    {
      name: 'linkcode.workbench.appearance:v1',
      schema: PersistedAppearanceSchema,
      partialize: (state) => ({ textSize: state.textSize, reduceMotion: state.reduceMotion }),
    },
  ),
);
