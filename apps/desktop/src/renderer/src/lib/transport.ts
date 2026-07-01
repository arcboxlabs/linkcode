import { SocketIoTransport } from '@linkcode/transport';

/** Desktop renderer data-plane connection to the local daemon. */
export const DAEMON_URL = 'http://127.0.0.1:4317';

/** Single transport instance for the renderer lifetime; system-plane IPC stays separate. */
export const transport = new SocketIoTransport({ url: DAEMON_URL });
