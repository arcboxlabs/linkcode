import { SocketIoTransport } from '@linkcode/transport';
import { Workbench, WorkbenchProviders } from '@linkcode/workbench';
import type { ReactNode } from 'react';
import { AppI18nProvider } from './i18n/app-i18n-provider';
import { DesktopWorkbenchShell } from './shell/desktop-workbench-shell';

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
const DAEMON_URL = 'http://127.0.0.1:4317';
const transport = new SocketIoTransport({ url: DAEMON_URL });

export function App(): ReactNode {
  return (
    <AppI18nProvider>
      <WorkbenchProviders transport={transport} daemonUrl={DAEMON_URL}>
        <Workbench shellComponent={DesktopWorkbenchShell} />
      </WorkbenchProviders>
    </AppI18nProvider>
  );
}
