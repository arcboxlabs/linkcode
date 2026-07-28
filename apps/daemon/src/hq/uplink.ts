import { hostname } from 'node:os';
import { TunnelTransportServer } from '@linkcode/transport';
import type { Hub } from '@linkcode/transport/server';
import { noop } from 'foxts/noop';
import { logger } from '../logger';
import { fetchTunnelToken } from './api';
import { loadHqCredentials } from './credentials';
import { ensureDeviceKey } from './device-key';

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
    logger.info({ operation: 'uplink.connect' }, 'Cloud uplink disabled');
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
    transport.onStateChange((state) => {
      logger.info({ operation: 'uplink.state', state }, 'Cloud uplink state changed');
    });
    transport.onConnection((connection) => {
      hub.addConnection(connection);
      connection.onClose(() => hub.removeConnection(connection));
    });
    try {
      await transport.connect();
    } catch (err) {
      if (stopped) return;
      logger.warn(
        { err, operation: 'uplink.connect' },
        'Cloud uplink connection failed; retry scheduled',
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
        logger.warn({ operation: 'uplink.close' }, 'Cloud uplink stopped permanently');
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
