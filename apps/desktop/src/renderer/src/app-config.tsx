import { resolveLocale } from '@linkcode/i18n';
import type { ThemePreference } from '@linkcode/ipc';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { DesktopAppConfig } from './app-config-context';
import { DesktopAppConfigContext } from './app-config-context';
import { systemBridge } from './ipc';

export function DesktopAppConfigProvider({ children }: { children: ReactNode }): ReactNode {
  const [initial] = useState(() => systemBridge.settings.snapshot());
  const [theme, setTheme] = useState<ThemePreference>(initial.theme);
  const [localeOverride, setLocaleOverride] = useState<string | null>(initial.locale);
  const [daemonUrl, setDaemonUrl] = useState(initial.daemonUrl);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Menubar / Cmd+, opens Settings even while the daemon is unreachable.
  useEffect(() => systemBridge.app.onOpenSettings(() => setSettingsOpen(true)), []);

  const value = useMemo<DesktopAppConfig>(
    () => ({
      theme,
      localeOverride,
      effectiveLocale: localeOverride ? resolveLocale(localeOverride) : undefined,
      daemonUrl,
      settingsOpen,
      setTheme(next) {
        void systemBridge.settings.set({ theme: next });
        setTheme(next);
      },
      setLocaleOverride(locale) {
        void systemBridge.settings.set({ locale });
        setLocaleOverride(locale);
      },
      setDaemonUrl(url) {
        void systemBridge.settings.set({ daemonUrl: url });
        setDaemonUrl(url);
      },
      openSettings: () => setSettingsOpen(true),
      closeSettings: () => setSettingsOpen(false),
    }),
    [theme, localeOverride, daemonUrl, settingsOpen],
  );

  return <DesktopAppConfigContext value={value}>{children}</DesktopAppConfigContext>;
}
