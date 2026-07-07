import type { ThemePreference } from '@linkcode/ipc';
import { create } from 'zustand';
import { systemBridge } from '../ipc';

/**
 * System-plane settings mirror plus the Settings surface open state, living above the connection
 * gate. Seeded synchronously from the main-process snapshot so first paint is correct; every change
 * writes through to main, which owns validation and persistence — nothing persists renderer-side.
 */
export interface DesktopSettingsState {
  theme: ThemePreference;
  /** Stored locale override, or null to follow the OS. */
  localeOverride: string | null;
  /** Effective endpoint the transport dials (explicit override or discovered). */
  daemonUrl: string;
  /** Stored override, or null to discover the local daemon automatically. */
  daemonUrlOverride: string | null;
  settingsOpen: boolean;
  setTheme: (theme: ThemePreference) => void;
  setLocaleOverride: (locale: string | null) => void;
  /** Pass null to clear the override and fall back to auto-discovery. */
  setDaemonUrl: (url: string | null) => void;
  /** Adopt a rediscovered endpoint (connection-gate polling) without persisting an override. */
  adoptDiscoveredUrl: (url: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

const initial = systemBridge.settings.snapshot();

export const useDesktopSettingsStore = create<DesktopSettingsState>()((set) => ({
  theme: initial.theme,
  localeOverride: initial.locale,
  daemonUrl: initial.daemonUrl ?? systemBridge.daemon.resolveUrl(),
  daemonUrlOverride: initial.daemonUrl,
  settingsOpen: false,

  setTheme(theme) {
    void systemBridge.settings.set({ theme });
    set({ theme });
  },

  setLocaleOverride(localeOverride) {
    void systemBridge.settings.set({ locale: localeOverride });
    set({ localeOverride });
  },

  setDaemonUrl(url) {
    if (url !== null) {
      void systemBridge.settings.set({ daemonUrl: url });
      set({ daemonUrl: url, daemonUrlOverride: url });
      return;
    }
    // Discovery reads the persisted settings in main — clear the override there first.
    set({ daemonUrlOverride: null });
    void systemBridge.settings.set({ daemonUrl: null }).then(() => {
      set({ daemonUrl: systemBridge.daemon.resolveUrl() });
    });
  },

  adoptDiscoveredUrl: (url) => set({ daemonUrl: url }),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
