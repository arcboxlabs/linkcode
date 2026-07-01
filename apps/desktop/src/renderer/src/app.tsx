import { SocketIoTransport } from '@linkcode/transport';
import { Workbench, WorkbenchProviders } from '@linkcode/workbench';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { DesktopAppConfigProvider } from './app-config';
import { useDesktopAppConfig } from './app-config-context';
import { AppI18nProvider } from './i18n/app-i18n-provider';
import { SettingsView } from './settings/settings-view';
import { DesktopWorkbenchShell } from './shell/desktop-workbench-shell';

export function App(): ReactNode {
  return (
    <DesktopAppConfigProvider>
      <AppContent />
    </DesktopAppConfigProvider>
  );
}

function AppContent(): ReactNode {
  const { daemonUrl, effectiveLocale, settingsOpen } = useDesktopAppConfig();

  return (
    <AppI18nProvider locale={effectiveLocale}>
      {/* Remount on daemon-URL change: the old transport tears down via WorkbenchProviders cleanup. */}
      <DaemonConnection key={daemonUrl} daemonUrl={daemonUrl}>
        <Workbench shellComponent={DesktopWorkbenchShell} />
      </DaemonConnection>
      {settingsOpen ? <SettingsView /> : null}
    </AppI18nProvider>
  );
}

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
function DaemonConnection({
  daemonUrl,
  children,
}: {
  daemonUrl: string;
  children: ReactNode;
}): ReactNode {
  const [transport] = useState(() => new SocketIoTransport({ url: daemonUrl }));
  return (
    <WorkbenchProviders transport={transport} daemonUrl={daemonUrl}>
      {children}
    </WorkbenchProviders>
  );
}
