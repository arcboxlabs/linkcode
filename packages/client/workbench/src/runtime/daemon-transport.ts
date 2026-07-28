import type { Transport } from '@linkcode/transport';
import { SocketIoTransport } from '@linkcode/transport';
import { createDevMockTransport } from '../mock/dev-mock-transport';

/**
 * Construct the transport the workbench data plane rides on. `--mode mock` (dev only) swaps the
 * daemon for the in-process mock host; the `DEV` guard folds the mock out of production builds.
 */
export function createDaemonTransport(daemonUrl: string): Transport {
  if (import.meta.env.DEV && import.meta.env.MODE === 'mock') return createDevMockTransport();
  return new SocketIoTransport({ url: daemonUrl });
}
