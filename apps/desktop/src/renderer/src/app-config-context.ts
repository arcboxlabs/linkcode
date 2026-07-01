import type { Locale } from '@linkcode/i18n';
import type { ThemePreference } from '@linkcode/ipc';
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
  /** Locale to hand IntlProvider, or undefined to follow the OS (navigator.languages). */
  effectiveLocale: Locale | undefined;
  daemonUrl: string;
  settingsOpen: boolean;
  setTheme: (theme: ThemePreference) => void;
  setLocaleOverride: (locale: string | null) => void;
  setDaemonUrl: (url: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const DesktopAppConfigContext = createContext<DesktopAppConfig | null>(null);

export function useDesktopAppConfig(): DesktopAppConfig {
  const value = use(DesktopAppConfigContext);
  if (!value) throw new Error('useDesktopAppConfig must be used within DesktopAppConfigProvider');
  return value;
}
