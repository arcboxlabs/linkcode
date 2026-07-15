import type { Transport } from '@linkcode/transport';
import { SocketIoTransport, TunnelTransport, WsTransport } from '@linkcode/transport';
import type { HostProfile } from '../stores/host-store';
import { CLOUD_URL, fetchTunnelJwt } from './cloud/client';

/**
 * Pick the transport by host kind. Tunnel entries dial the cloud relay as a
 * client of the daemon's device id; direct entries pick by URL scheme —
 * http(s) dials the daemon's default Socket.IO listener (same as
 * webview/desktop), ws(s) dials a raw WebSocket listener.
 */
export function createHostTransport(host: HostProfile): Transport {
  if ('tunnelHostId' in host) {
    return new TunnelTransport({
      baseUrl: CLOUD_URL,
      role: 'client',
      hostId: host.tunnelHostId,
      getToken: fetchTunnelJwt,
    });
  }
  const { protocol } = new URL(host.url);
  return protocol === 'ws:' || protocol === 'wss:'
    ? new WsTransport({ url: host.url })
    : new SocketIoTransport({ url: host.url });
}
