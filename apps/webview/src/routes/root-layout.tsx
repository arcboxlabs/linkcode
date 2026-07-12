import { SessionNotifier, WorkbenchAppProviders, WorkbenchProviders } from '@linkcode/workbench';
import { webviewDaemonConnectionSource } from '@webview/daemon-connection-source';
import { presentWebNotification } from '@webview/notifications';
import { useSettingsStore } from '@webview/settings/store';
import { Outlet } from 'react-router';

/**
 * Root layout: global providers + the daemon connection, rendered once around every route's
 * `<Outlet>`. The daemon URL and locale come from the settings store, so editing them replaces the
 * connection generation / re-resolves the locale without a manual reload.
 */
export function RootLayout(): React.ReactNode {
  const locale = useSettingsStore((state) => state.locale);

  return (
    <WorkbenchAppProviders locale={locale}>
      <WorkbenchProviders connectionSource={webviewDaemonConnectionSource}>
        {/* Persistent across route changes, so background notifications keep arriving while the
            user is on a non-workbench route such as Settings. */}
        <SessionNotifier present={presentWebNotification} />
        <Outlet />
      </WorkbenchProviders>
    </WorkbenchAppProviders>
  );
}
