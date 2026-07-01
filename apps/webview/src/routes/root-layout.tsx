import { SocketIoTransport } from '@linkcode/transport';
import { WorkbenchAppProviders, WorkbenchProviders } from '@linkcode/workbench';
import { useSettingsStore } from '@webview/settings/store';
import { useSingleton } from 'foxact/use-singleton';
import { Outlet } from 'react-router';

/**
 * Root layout: global providers + the daemon connection, rendered once around every route's
 * `<Outlet>`. The daemon URL and locale come from the settings store, so editing them re-keys the
 * connection / re-resolves the locale without a manual reload.
 */
export function RootLayout(): React.ReactNode {
  const daemonUrl = useSettingsStore((state) => state.daemonUrl);
  const locale = useSettingsStore((state) => state.locale);

  return (
    <WorkbenchAppProviders locale={locale}>
      <DaemonConnection key={daemonUrl} daemonUrl={daemonUrl}>
        <Outlet />
      </DaemonConnection>
    </WorkbenchAppProviders>
  );
}

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
