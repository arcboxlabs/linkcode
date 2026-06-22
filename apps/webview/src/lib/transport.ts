import { SocketIoTransport } from '@linkcode/transport';

/**
 * The webview connects to the local host daemon (apps/daemon) directly — same as
 * every other client (PLAN §4). Data plane only; system-plane / IPC concerns do
 * not exist on the web.
 */
export const DAEMON_URL = 'http://127.0.0.1:4317';

/** Single transport instance for the app lifetime; the data providers wrap a client around it. */
export const transport = new SocketIoTransport({ url: DAEMON_URL });
