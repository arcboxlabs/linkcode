import { zodPersist } from '@linkcode/common/zustand';
import Storage from 'expo-sqlite/kv-store';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage } from 'zustand/middleware';

export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedSettingsSchema = z.object({ themePreference: ThemePreferenceSchema }).partial();
type PersistedSettings = z.infer<typeof PersistedSettingsSchema>;

export interface SettingsState {
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
}

export const useSettingsStore = create<SettingsState>()(
  zodPersist<SettingsState, [], [], PersistedSettings, PersistedSettings>(
    (set) => ({
      themePreference: 'system',
      setThemePreference: (preference) => set({ themePreference: preference }),
    }),
    {
      name: 'linkcode.mobile.settings:v1',
      schema: PersistedSettingsSchema,
      storage: createJSONStorage(() => Storage),
      partialize: (state) => ({ themePreference: state.themePreference }),
    },
  ),
);
