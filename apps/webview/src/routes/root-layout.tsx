import {
  CloudImProvider,
  createBrowserCloudImSource,
  SessionNotifier,
  WorkbenchAppProviders,
  WorkbenchProviders,
} from '@linkcode/workbench';
import { CLOUD_API_URL } from '@webview/cloud/auth';
import { webviewDaemonConnectionSource } from '@webview/daemon-connection-source';
import { presentWebNotification } from '@webview/notifications';
import { useSettingsStore } from '@webview/settings/store';
import { Outlet } from 'react-router';

/** Browser shell: the credential is the shared session cookie, so the source is plain fetch. */
const cloudImSource = createBrowserCloudImSource(CLOUD_API_URL);

/**
 * Root layout: global providers + the daemon connection, rendered once around every route's
 * `<Outlet>`. Daemon URL and locale come from the settings store, so edits apply live —
 * a URL change replaces the connection generation, no manual reload.
 */
export function RootLayout(): React.ReactNode {
  const locale = useSettingsStore((state) => state.locale);

  return (
    <WorkbenchAppProviders locale={locale}>
      <CloudImProvider source={cloudImSource}>
        <WorkbenchProviders connectionSource={webviewDaemonConnectionSource}>
          {/* Persistent across route changes, so background notifications keep arriving while the
              user is on a non-workbench route such as Settings. */}
          <SessionNotifier present={presentWebNotification} />
          <Outlet />
        </WorkbenchProviders>
      </CloudImProvider>
    </WorkbenchAppProviders>
  );
}
