import type { Transport } from '@linkcode/transport';
import { SocketIoTransport, WsTransport } from '@linkcode/transport';

/**
 * Pick the transport by URL scheme: http(s) dials the daemon's default Socket.IO
 * listener (same as webview/desktop); ws(s) dials a raw WebSocket listener — the
 * shape the HQ tunnel will use.
 */
export function createHostTransport(url: string): Transport {
  const { protocol } = new URL(url);
  return protocol === 'ws:' || protocol === 'wss:'
    ? new WsTransport({ url })
    : new SocketIoTransport({ url });
}
