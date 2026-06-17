import { SocketIoTransport } from '@linkcode/transport';
import type { WorkbenchSystemBridge } from '@linkcode/ui';
import type { ReactElement } from 'react';
import { AppI18nProvider } from './i18n/AppI18nProvider';
import { systemBridge } from './ipc';
import { ConnectedWorkbench } from './workbench/ConnectedWorkbench';

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
const DAEMON_URL = 'http://127.0.0.1:4317';
const transport = new SocketIoTransport({ url: DAEMON_URL });

/** Window controls go through system IPC — the system plane, never business data (PLAN §4.5). */
const bridge: WorkbenchSystemBridge = {
  window: {
    minimize: () => void systemBridge.window.minimize(),
    toggleMaximize: () => void systemBridge.window.toggleMaximize(),
    close: () => void systemBridge.window.close(),
  },
};

export function App(): ReactElement {
  return (
    <AppI18nProvider>
      <ConnectedWorkbench transport={transport} daemonUrl={DAEMON_URL} systemBridge={bridge} />
    </AppI18nProvider>
  );
}
