import type { Transport } from '@linkcode/transport';
import { createLocalTransportPair } from '@linkcode/transport';
import { DevMockHost } from './dev-mock-host';

export function createDevMockTransport(): Transport {
  const [client, host] = createLocalTransportPair();
  // Hand the app the client endpoint; the mock host owns the peer and speaks real wire messages.
  const mock = new DevMockHost(host);
  mock.start();
  return client;
}
