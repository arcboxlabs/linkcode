import type { ThemePreference } from '@linkcode/ipc';
import type { AgentKind } from '@linkcode/schema';
import { useNavigationHistoryStore } from '@linkcode/workbench';
import { create } from 'zustand';
import { systemBridge } from '../ipc';

export type SettingsCategory =
  | 'general'
  | 'connection'
  | 'notifications'
  | 'about'
  | 'agents'
  | 'history-import';

/**
 * System-plane settings mirror, living above the connection gate. Seeded synchronously from the
 * main-process snapshot so first paint is correct; every change writes through to main, which owns
 * validation and persistence — nothing persists renderer-side. (The Settings surface open state
 * lives in the workbench navigation history store.)
 *
 * Also holds the renderer-only Settings *view* state: the surface renders inside the
 * daemon-URL-keyed connection subtree, so component state would reset the moment a new URL is
 * saved in the Connection tab (or auto-adopted by rediscovery) — module scope survives that.
 */
export interface DesktopSettingsState {
  theme: ThemePreference;
  /** Stored locale override, or null to follow the OS. */
  localeOverride: string | null;
  /** Effective endpoint the transport dials (explicit override or discovered). */
  daemonUrl: string;
  /** Stored override, or null to discover the local daemon automatically. */
  daemonUrlOverride: string | null;
  settingsCategory: SettingsCategory;
  historyImportProvider: AgentKind;
  setTheme: (theme: ThemePreference) => void;
  setLocaleOverride: (locale: string | null) => void;
  /** Pass null to clear the override and fall back to auto-discovery. */
  setDaemonUrl: (url: string | null) => void;
  /** Adopt a rediscovered endpoint (connection-gate polling) without persisting an override. */
  adoptDiscoveredUrl: (url: string) => void;
  setSettingsCategory: (category: SettingsCategory) => void;
  setHistoryImportProvider: (provider: AgentKind) => void;
}

const initial = systemBridge.settings.snapshot();

export const useDesktopSettingsStore = create<DesktopSettingsState>()((set) => ({
  theme: initial.theme,
  localeOverride: initial.locale,
  daemonUrl: initial.daemonUrl ?? systemBridge.daemon.resolveUrl(),
  daemonUrlOverride: initial.daemonUrl,
  settingsCategory: 'general',
  historyImportProvider: 'claude-code',

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

  setSettingsCategory: (category) => set({ settingsCategory: category }),
  setHistoryImportProvider: (provider) => set({ historyImportProvider: provider }),
}));

/**
 * Open the Settings overlay at a category. Every entry point routes through here: generic ones
 * (sidebar button, palette "Open settings", the native menu) take the `general` default so a
 * previous deep link doesn't leak into the next open — the category is store-held and would
 * otherwise stick across close/reopen.
 */
export function openDesktopSettings(category: SettingsCategory = 'general'): void {
  useDesktopSettingsStore.getState().setSettingsCategory(category);
  useNavigationHistoryStore.getState().openOverlay('settings');
}
