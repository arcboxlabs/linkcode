import type { ThemePreference } from '@linkcode/ipc';
import type { AgentKind } from '@linkcode/schema';
import { useNavigationHistoryStore } from '@linkcode/workbench';
import { create } from 'zustand';
import { systemBridge } from '../ipc';

export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'terminal'
  | 'developer'
  | 'notifications'
  | 'about'
  | 'providers'
  | 'agents'
  | 'imChannel'
  | 'history-import';

/**
 * System-plane settings mirror, living above the connection gate: seeded synchronously from the
 * main-process snapshot so first paint is correct; every change writes through to main, which owns
 * validation and persistence — nothing persists renderer-side. Also holds the renderer-only
 * Settings *view* state (the surface's open state lives in the navigation history store).
 */
export interface DesktopSettingsState {
  theme: ThemePreference;
  /** Stored locale override, or null to follow the OS. */
  localeOverride: string | null;
  /** Stored override, or null to discover the local daemon automatically. */
  daemonUrlOverride: string | null;
  settingsCategory: SettingsCategory;
  historyImportProvider: AgentKind;
  setTheme: (theme: ThemePreference) => void;
  setLocaleOverride: (locale: string | null) => void;
  /** Pass null to clear the override and fall back to auto-discovery. */
  setDaemonUrl: (url: string | null) => Promise<void>;
  setSettingsCategory: (category: SettingsCategory) => void;
  setHistoryImportProvider: (provider: AgentKind) => void;
}

const initial = systemBridge.settings.snapshot();

export const useDesktopSettingsStore = create<DesktopSettingsState>()((set) => ({
  theme: initial.theme,
  localeOverride: initial.locale,
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

  async setDaemonUrl(url) {
    // Source invalidation happens only after main has persisted the value, so its synchronous
    // resolveUrl snapshot and the renderer mirror cannot disagree about which endpoint to dial.
    const next = await systemBridge.settings.set({ daemonUrl: url });
    set({ daemonUrlOverride: next.daemonUrl });
  },

  setSettingsCategory: (category) => set({ settingsCategory: category }),
  setHistoryImportProvider: (provider) => set({ historyImportProvider: provider }),
}));

/**
 * Open the Settings overlay at a category. Every entry point routes through here; generic ones
 * take the `general` default because the category is store-held and a previous deep link would
 * otherwise stick across close/reopen.
 */
export function openDesktopSettings(category: SettingsCategory = 'general'): void {
  useDesktopSettingsStore.getState().setSettingsCategory(category);
  useNavigationHistoryStore.getState().openOverlay('settings');
}
