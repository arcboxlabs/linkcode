import { SocketIoTransport } from '@linkcode/transport';
import { Workbench, WorkbenchAppProviders, WorkbenchProviders } from '@linkcode/workbench';
import { useSingleton } from 'foxact/use-singleton';
import { DesktopAppConfigProvider } from './app-config';
import { useDesktopAppConfig } from './app-config-context';
import { SettingsView } from './settings/settings-view';
import { DesktopWorkbenchShell } from './shell/desktop-workbench-shell';

export function DesktopApp(): React.ReactNode {
  return (
    <DesktopAppConfigProvider>
      <AppContent />
    </DesktopAppConfigProvider>
  );
}

function AppContent(): React.ReactNode {
  const { daemonUrl, localeOverride, settingsOpen } = useDesktopAppConfig();

  return (
    <WorkbenchAppProviders locale={localeOverride}>
      {/* Remount on daemon-URL change: the old transport tears down via WorkbenchProviders cleanup. */}
      <DaemonConnection key={daemonUrl} daemonUrl={daemonUrl}>
        <Workbench shellComponent={DesktopWorkbenchShell} />
      </DaemonConnection>
      {settingsOpen ? <SettingsView /> : null}
    </WorkbenchAppProviders>
  );
}

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
function DaemonConnection({
  daemonUrl,
  children,
}: React.PropsWithChildren<{ daemonUrl: string }>): React.ReactNode {
  const { current: transport } = useSingleton(() => new SocketIoTransport({ url: daemonUrl }));
  return (
    <WorkbenchProviders transport={transport} daemonUrl={daemonUrl}>
      {children}
    </WorkbenchProviders>
  );
}
