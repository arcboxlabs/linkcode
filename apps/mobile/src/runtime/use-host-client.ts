import { LinkCodeClient } from '@linkcode/client-core';
import { useEffect } from 'foxact/use-abortable-effect';
import { useCallback, useState } from 'react';
import { createHostTransport } from './create-host-transport';

export type HostConnectionStatus = 'connecting' | 'ready' | 'error';

export interface HostClientState {
  client: LinkCodeClient;
  status: HostConnectionStatus;
  /** Tears down the current client and dials again. */
  retry: () => void;
}

/**
 * Owns one client's connection lifecycle for a host URL, mirroring the state machine
 * of workbench's WorkbenchRuntimeConnection: connecting → ready | error, retry by
 * recreating the transport + client pair.
 */
export function useHostClient(url: string): HostClientState {
  const [client, setClient] = useState(() => new LinkCodeClient(createHostTransport(url)));
  const [status, setStatus] = useState<HostConnectionStatus>('connecting');

  // Render-time reset keeps the client in sync when the same mounted screen
  // switches to a different host URL.
  const [trackedUrl, setTrackedUrl] = useState(url);
  if (trackedUrl !== url) {
    setTrackedUrl(url);
    setStatus('connecting');
    setClient(new LinkCodeClient(createHostTransport(url)));
  }

  const retry = useCallback(() => {
    setStatus('connecting');
    setClient(new LinkCodeClient(createHostTransport(url)));
  }, [url]);

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
