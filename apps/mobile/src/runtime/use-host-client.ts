import { LinkCodeClient } from '@linkcode/client-core';
import { useEffect } from 'foxact/use-abortable-effect';
import { useCallback, useState } from 'react';
import type { HostProfile } from '../stores/host-store';
import { createHostTransport } from './create-host-transport';

export type HostConnectionStatus = 'connecting' | 'ready' | 'error';

export interface HostClientState {
  client: LinkCodeClient;
  status: HostConnectionStatus;
  /** Tears down the current client and dials again. */
  retry: () => void;
}

/**
 * Owns one client's connection lifecycle for a host, mirroring the state machine
 * of workbench's WorkbenchRuntimeConnection: connecting → ready | error, retry by
 * recreating the transport + client pair.
 */
export function useHostClient(host: HostProfile): HostClientState {
  const [client, setClient] = useState(() => new LinkCodeClient(createHostTransport(host)));
  const [status, setStatus] = useState<HostConnectionStatus>('connecting');

  // Render-time reset keeps the client in sync when the same mounted screen
  // switches to a different host.
  const [trackedId, setTrackedId] = useState(host.id);
  if (trackedId !== host.id) {
    setTrackedId(host.id);
    setStatus('connecting');
    setClient(new LinkCodeClient(createHostTransport(host)));
  }

  const retry = useCallback(() => {
    setStatus('connecting');
    setClient(new LinkCodeClient(createHostTransport(host)));
  }, [host]);

  // Status is already 'connecting' wherever a client is (re)created: initial state,
  // the render-time reset above, and retry.
  useEffect(
    (signal) => {
      client
        .connect()
        .then(() => {
          if (!signal.aborted) setStatus('ready');
        })
        .catch(() => {
          if (!signal.aborted) setStatus('error');
        });

      return () => client.dispose();
    },
    [client],
  );

  return { client, status, retry };
}
