import { hostname } from 'node:os';
import { TunnelTransport } from '@linkcode/transport';
import type { Hub } from '@linkcode/transport/server';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { fetchTunnelToken } from './api';
import { loadHqCredentials } from './credentials';

const log = (message: string): void => console.log(`[linkcode/daemon] ${message}`);

/** How long to wait before redialing when HQ is unreachable at boot. */
const CONNECT_RETRY_MS = 30000;

/**
 * Attach this daemon to the HQ relay as the account's host. The relay merges
 * every remote client onto this one connection and broadcasts our frames back
 * to them — the same fan-out contract as the {@link Hub} — so the uplink is
 * just one more Hub connection and reply routing works unchanged.
 *
 * Transient drops reconnect inside {@link TunnelTransport}; only a first
 * dial that never succeeds is retried here (the daemon may boot offline).
 * A *permanent* close — replaced by another daemon under the same device id,
 * credential revoked, signed out — stops the uplink for good: retrying would
 * either fight the replacement or spam a dead credential. Sign in again and
 * restart the daemon to recover.
 *
 * Returns a stop function for shutdown.
 */
export function startHqUplink(hub: Hub): () => void {
  const credentials = loadHqCredentials();
  if (!credentials) {
    log('cloud uplink off — run `linkcode-daemon login` to enable remote access');
    return noop;
  }

  let stopped = false;
  let active: TunnelTransport | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const attempt = async (): Promise<void> => {
    const transport = new TunnelTransport({
      baseUrl: credentials.baseUrl,
      role: 'host',
      hostId: credentials.deviceId,
      name: hostname(),
      getToken: () => fetchTunnelToken(credentials.baseUrl, credentials.sessionToken),
    });
    transport.onStateChange((state) => log(`cloud uplink ${state}`));
    try {
      await transport.connect();
    } catch (err) {
      if (stopped) return;
      log(
        `cloud uplink connect failed (${extractErrorMessage(err)}); retrying in ${CONNECT_RETRY_MS / 1000}s`,
      );
      retryTimer = setTimeout(() => {
        void attempt();
      }, CONNECT_RETRY_MS);
      return;
    }
    if (stopped) {
      transport.close();
      return;
    }
    active = transport;
    hub.addConnection(transport);
    transport.onClose(() => {
      hub.removeConnection(transport);
      active = null;
      if (!stopped) {
        log('cloud uplink stopped — sign in again and restart the daemon to restore remote access');
      }
    });
  };

  void attempt();
  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    active?.close();
  };
}
