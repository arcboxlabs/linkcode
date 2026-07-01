import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const DEFAULT_DAEMON_URL = 'http://127.0.0.1:4317';

/** Persisted subset — every field optional so partial/stale storage merges over the defaults. */
const PersistedSettingsSchema = z
  .object({
    theme: ThemePreferenceSchema,
    locale: z.string().nullable(),
    daemonUrl: z.url(),
  })
  .partial();
type PersistedSettings = z.infer<typeof PersistedSettingsSchema>;

/** The webview's local client settings — persisted to localStorage, never sent to the daemon. */
export interface SettingsState {
  theme: ThemePreference;
  /** Locale override, or null to follow the browser (navigator.languages). */
  locale: string | null;
  /** Daemon endpoint the client dials over transport. */
  daemonUrl: string;
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: string | null) => void;
  setDaemonUrl: (daemonUrl: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  zodPersist<SettingsState, [], [], PersistedSettings, PersistedSettings>(
    (set) => ({
      theme: 'system',
      locale: null,
      daemonUrl: DEFAULT_DAEMON_URL,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setDaemonUrl: (daemonUrl) => set({ daemonUrl }),
    }),
    {
      name: 'linkcode.webview.settings:v1',
      schema: PersistedSettingsSchema,
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        daemonUrl: state.daemonUrl,
      }),
    },
  ),
);
