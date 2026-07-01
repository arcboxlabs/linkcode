import type { ThemePreference } from '@linkcode/ipc';
import { nullthrow } from 'foxact/nullthrow';
import { createContext, use } from 'react';

/**
 * App-level system settings that live above the connection gate: theme, locale, and the daemon
 * endpoint, plus the open state of the full-page Settings surface. Seeded synchronously from the
 * main-process snapshot so first paint is correct, and mirrored back to main on every change.
 */
export interface DesktopAppConfig {
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
  openSettings: () => void;
  closeSettings: () => void;
}

export const DesktopAppConfigContext = createContext<DesktopAppConfig | null>(null);

export function useDesktopAppConfig(): DesktopAppConfig {
  return nullthrow(
    use(DesktopAppConfigContext),
    'useDesktopAppConfig must be used within DesktopAppConfigProvider',
  );
}
