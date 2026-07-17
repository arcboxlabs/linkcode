import { hostname } from 'node:os';
import { TunnelTransportServer } from '@linkcode/transport';
import type { Hub } from '@linkcode/transport/server';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { fetchTunnelToken } from './api';
import { loadHqCredentials } from './credentials';
import { ensureDeviceKey } from './device-key';

const log = (message: string): void => console.log(`[linkcode/daemon] ${message}`);

/** How long to wait before redialing when HQ is unreachable at boot. */
const CONNECT_RETRY_MS = 30000;

/**
 * Attach this daemon to the cloud relay as the account's host; {@link TunnelTransportServer}
 * presents each relay-attested peer as its own Hub connection. Transient drops reconnect inside
 * it — only a never-successful first dial is retried here (the daemon may boot offline). A
 * *permanent* close (replaced under the same device id, credential revoked, signed out) stops the
 * uplink for good; sign in again and restart to recover. Returns a stop function for shutdown.
 */
export function startHqUplink(hub: Hub): () => void {
  const credentials = loadHqCredentials();
  if (!credentials) {
    log('cloud uplink off — run `linkcode-daemon login` to enable remote access');
    return noop;
  }

  const key = ensureDeviceKey();
  let stopped = false;
  let active: TunnelTransportServer | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const attempt = async (): Promise<void> => {
    const transport = new TunnelTransportServer({
      baseUrl: credentials.baseUrl,
      hostId: credentials.deviceId,
      name: hostname(),
      getToken: () => fetchTunnelToken(credentials.baseUrl, credentials.sessionToken),
      // Proof of possession: the relay requires keyed hosts to sign the very
      // token they present, so a leaked token alone cannot host this device.
      signToken: (accessToken) => key.sign(accessToken),
    });
    transport.onStateChange((state) => log(`cloud uplink ${state}`));
    transport.onConnection((connection) => {
      hub.addConnection(connection);
      connection.onClose(() => hub.removeConnection(connection));
    });
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
      void transport.close();
      return;
    }
    active = transport;
    transport.onClose(() => {
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
    void active?.close();
  };
}
