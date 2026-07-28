import { LinkCodeClient } from '@linkcode/client-core';
import { randomUUID } from 'expo-crypto';
import { useEffect } from 'foxact/use-abortable-effect';
import { useCallback, useState } from 'react';
import type { HostProfile } from '../stores/host-store';
import { createHostTransport } from './create-host-transport';
import { captureMobileProductEvent } from './product-analytics';

export type HostConnectionStatus = 'connecting' | 'ready' | 'error';

export interface HostClientState {
  client: LinkCodeClient;
  status: HostConnectionStatus;
  /** Tears down the current client and dials again. */
  retry: () => void;
}

const connectionStartedAtByClient = new WeakMap<LinkCodeClient, number>();

/**
 * One client's connection lifecycle per host, mirroring workbench's WorkbenchRuntimeConnection:
 * connecting → ready | error; retry recreates the transport + client pair.
 */
export function useHostClient(host: HostProfile): HostClientState {
  const [client, setClient] = useState(() => createClient(host));
  const [status, setStatus] = useState<HostConnectionStatus>('connecting');

  // Render-time reset keeps the client in sync when the same mounted screen
  // switches to a different host.
  const [trackedId, setTrackedId] = useState(host.id);
  if (trackedId !== host.id) {
    setTrackedId(host.id);
    setStatus('connecting');
    setClient(createClient(host));
  }

  const retry = useCallback(() => {
    setStatus('connecting');
    setClient(createClient(host));
  }, [host]);

  // Status is already 'connecting' wherever a client is (re)created: initial state,
  // the render-time reset above, and retry.
  useEffect(
    (signal) => {
      const connectionStartedAt = connectionStartedAtByClient.get(client) ?? Date.now();
      const offClose = client.onClose(() => {
        if (!signal.aborted) setStatus('error');
      });
      client
        .connect()
        .then(() => {
          if (!signal.aborted) {
            setStatus('ready');
            captureMobileProductEvent('host connection ready', {
              duration_ms: Date.now() - connectionStartedAt,
            });
          }
        })
        .catch(() => {
          if (!signal.aborted) {
            setStatus('error');
            captureMobileProductEvent('host connection failed', {
              duration_ms: Date.now() - connectionStartedAt,
            });
          }
        });

      return () => {
        offClose();
        client.dispose();
      };
    },
    [client],
  );

  return { client, status, retry };
}

function createClient(host: HostProfile): LinkCodeClient {
  const client = new LinkCodeClient(createHostTransport(host), { randomUUID });
  connectionStartedAtByClient.set(client, Date.now());
  return client;
}
