import { SocketIoTransport } from '@linkcode/transport';
import { Workbench, type WorkbenchSystemBridge } from '@linkcode/ui';
import type { ReactElement } from 'react';
import { systemBridge } from './ipc';

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
const DAEMON_URL = 'http://127.0.0.1:4317';
const transport = new SocketIoTransport({ url: DAEMON_URL });

/** Window controls go through TypeSafe IPC (tRPC) — the system plane, never business data (PLAN §4.5). */
const bridge: WorkbenchSystemBridge = {
  window: {
    minimize: () => void systemBridge.window.minimize.mutate(),
    toggleMaximize: () => void systemBridge.window.toggleMaximize.mutate(),
    close: () => void systemBridge.window.close.mutate(),
  },
};

export function App(): ReactElement {
  return <Workbench transport={transport} daemonUrl={DAEMON_URL} systemBridge={bridge} />;
}
