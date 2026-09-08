import { zodPersist } from '@linkcode/common/zustand';
import Storage from 'expo-sqlite/kv-store';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage } from 'zustand/middleware';

export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedSettingsSchema = z
  .object({
    themePreference: ThemePreferenceSchema,
    keepHostsConnected: z.boolean(),
    notificationsEnabled: z.boolean(),
  })
  .partial();
type PersistedSettings = z.infer<typeof PersistedSettingsSchema>;

export interface SettingsState {
  themePreference: ThemePreference;
  /** Hold every saved host's connection open, not just the selected one. Off by default: a phone
   * pays for each socket in bytes and battery, and only one host is on screen at a time. */
  keepHostsConnected: boolean;
  notificationsEnabled: boolean;
  setThemePreference: (preference: ThemePreference) => void;
  setKeepHostsConnected: (keep: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  zodPersist<SettingsState, [], [], PersistedSettings, PersistedSettings>(
    (set) => ({
      themePreference: 'system',
      keepHostsConnected: false,
      notificationsEnabled: false,
      setThemePreference: (preference) => set({ themePreference: preference }),
      setKeepHostsConnected: (keep) => set({ keepHostsConnected: keep }),
      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
    }),
    {
      name: 'linkcode.mobile.settings:v2',
      schema: PersistedSettingsSchema,
      storage: createJSONStorage(() => Storage),
      partialize: (state) => ({
        themePreference: state.themePreference,
        keepHostsConnected: state.keepHostsConnected,
        notificationsEnabled: state.notificationsEnabled,
      }),
    },
  ),
);
