import { SocketIoTransport } from '@linkcode/transport';
import { ConnectedWorkbench } from '@linkcode/workbench';
import type { ReactElement } from 'react';

const DAEMON_URL = 'http://127.0.0.1:4317';
const transport = new SocketIoTransport({ url: DAEMON_URL });

export function WorkbenchPage(): ReactElement {
  return <ConnectedWorkbench transport={transport} daemonUrl={DAEMON_URL} />;
}
