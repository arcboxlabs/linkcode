import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

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

export const DEFAULT_DAEMON_URL = 'http://127.0.0.1:4317';

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      locale: null,
      daemonUrl: DEFAULT_DAEMON_URL,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setDaemonUrl: (daemonUrl) => set({ daemonUrl }),
    }),
    { name: 'linkcode.webview.settings:v1' },
  ),
);
