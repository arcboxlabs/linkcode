import {
  createDaemonTransport,
  SessionNotifier,
  WorkbenchAppProviders,
  WorkbenchProviders,
} from '@linkcode/workbench';
import { presentWebNotification } from '@webview/notifications';
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
  const { current: transport } = useSingleton(() => createDaemonTransport(daemonUrl));
  return (
    <WorkbenchProviders transport={transport} daemonUrl={daemonUrl}>
      {/* Persistent across route changes, so background notifications keep arriving while the user
          is on a non-workbench route such as Settings. */}
      <SessionNotifier present={presentWebNotification} />
      {children}
    </WorkbenchProviders>
  );
}
