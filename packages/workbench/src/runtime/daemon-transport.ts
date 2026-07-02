import type { Transport } from '@linkcode/transport';
import { SocketIoTransport } from '@linkcode/transport';
import { createDevMockTransport } from '../mock/dev-mock-transport';

/**
 * Construct the transport the workbench data plane rides on. Dev-only escape hatch: running the
 * app with `--mode mock` (`pnpm dev:mock`) swaps the daemon for the in-process mock host; the
 * `DEV` guard makes production builds fold the mock away entirely.
 */
export function createDaemonTransport(daemonUrl: string): Transport {
  if (import.meta.env.DEV && import.meta.env.MODE === 'mock') return createDevMockTransport();
  return new SocketIoTransport({ url: daemonUrl });
}
