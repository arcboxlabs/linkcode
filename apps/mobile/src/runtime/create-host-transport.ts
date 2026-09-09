import type { Transport } from '@linkcode/transport';
import { SocketIoTransport, TunnelTransport, WsTransport } from '@linkcode/transport';
import type { HostProfile } from '@mobile/stores/host-store';
import { CLOUD_URL, fetchTunnelJwt } from './cloud/client';

type MockModule = typeof import('@linkcode/client-core/mock');

/**
 * Transport by host kind: tunnel entries dial the cloud relay; direct entries pick by
 * URL scheme — http(s) is the daemon's default Socket.IO listener (same as
 * webview/desktop), ws(s) a raw WebSocket listener, and `mock:` the in-process mock host
 * (webview's `dev:mock` showcase). Dev builds only: the `__DEV__` guard keeps Metro from
 * bundling the mock into release, where the throw surfaces as a plain connection failure.
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
  if (protocol === 'mock:') {
    if (__DEV__) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- static import would bundle the mock into release builds
      const mock = require('@linkcode/client-core/mock') as MockModule;
      return mock.createDevMockTransport();
    }
    throw new Error('mock:// hosts are only available in development builds');
  }
  return protocol === 'ws:' || protocol === 'wss:'
    ? new WsTransport({ url: host.url })
    : new SocketIoTransport({ url: host.url });
}
