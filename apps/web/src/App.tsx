import { SocketIoTransport } from '@linkcode/transport';
import { Workbench } from '@linkcode/ui';
import type { ReactElement } from 'react';

/** The web client connects to the local daemon (apps/daemon) over Socket.IO. */
const DAEMON_URL = 'http://127.0.0.1:4317';
const transport = new SocketIoTransport({ url: DAEMON_URL });

export function App(): ReactElement {
  return <Workbench transport={transport} daemonUrl={DAEMON_URL} />;
}
