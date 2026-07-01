import { resolveLocale } from '@linkcode/i18n';
import { SocketIoTransport } from '@linkcode/transport';
import { WorkbenchProviders } from '@linkcode/workbench';
import { RootProviders } from '@webview/providers/root-providers';
import { useSettingsStore } from '@webview/settings/store';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Outlet } from 'react-router';

/**
 * Root layout: global providers + the daemon connection, rendered once around every route's
 * `<Outlet>`. The daemon URL and locale come from the settings store, so editing them re-keys the
 * connection / re-resolves the locale without a manual reload.
 */
export function RootLayout(): ReactNode {
  const daemonUrl = useSettingsStore((state) => state.daemonUrl);
  const locale = useSettingsStore((state) => state.locale);

  return (
    <RootProviders locale={locale ? resolveLocale(locale) : undefined}>
      <DaemonConnection key={daemonUrl} daemonUrl={daemonUrl}>
        <Outlet />
      </DaemonConnection>
    </RootProviders>
  );
}

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
