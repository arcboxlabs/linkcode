import type { LinkCodeClient } from '@linkcode/client-core';
import type { HostProfile } from '@mobile/stores/host-store';
import NetInfo from '@react-native-community/netinfo';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { connectionFor } from './host-connection-pool';

export type HostConnectionStatus = 'connecting' | 'ready' | 'error';

interface HostClientBase {
  /** Attempt number of the in-flight or last recovery run; above 1 means this is a reconnect. */
  readonly attempt: number;
  /** Abandon any pending backoff and dial again now. */
  readonly retry: () => void;
  /** Why the last attempt failed, when the controller knows. Kept because "unable to reach" alone
   * tells neither the user nor a triager whether the host is down, unreachable, or speaking a
   * different wire version — the causes need entirely different responses. */
  readonly failure?: string;
}

interface HostClientReady extends HostClientBase {
  readonly status: 'ready';
  readonly client: LinkCodeClient;
}

interface HostClientPending extends HostClientBase {
  readonly status: 'connecting' | 'error';
  readonly client: null;
}

export type HostClientState = HostClientReady | HostClientPending;

/**
 * One host's connection lifecycle. The connection itself belongs to the pool, so switching to a
 * host that is already warm costs a subscription rather than a handshake, and this hook never
 * disposes anything — {@link pruneConnections} decides what survives.
 *
 * `retrying` is reported as `connecting` — the distinction is in `attempt`, so a caller that only
 * branches on the three statuses needs no change.
 */
export function useHostClient(host: HostProfile): HostClientState {
  const controller = connectionFor(host);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  // Both triggers only ever hurry a stalled connection along; neither tears down a healthy one.
  useEffect(() => {
    const hurryAlong = (): void => {
      if (controller.getSnapshot().status !== 'ready') controller.retry();
    };
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') hurryAlong();
    });
    const offNetInfo = NetInfo.addEventListener((state) => {
      if (state.isConnected === true) hurryAlong();
    });
    return () => {
      appState.remove();
      offNetInfo();
    };
  }, [controller]);

  const retry = useCallback(() => controller.retry(), [controller]);
  const client = snapshot.contextGeneration?.client ?? null;
  const readyClient = client && snapshot.status === 'ready' ? client : null;

  // A phone pays for bytes and battery, so it takes only the sessions it opened rather than every
  // session on the host. Re-sent per generation: a recovered connection starts back at `all`.
  // Failing leaves the daemon broadcasting everything, which is wasteful but not broken.
  useEffect(() => {
    if (!readyClient) return;
    // eslint-disable-next-line sukka/react-no-use-effect-watching -- a request to the daemon, not a useState setter the `set` prefix suggests
    readyClient.setSubscriptionMode('attached').catch(noop);
  }, [readyClient]);

  return readyClient
    ? { attempt: snapshot.attempt, client: readyClient, retry, status: 'ready' }
    : {
        attempt: snapshot.attempt,
        client: null,
        failure: extractErrorMessage(snapshot.error, false) ?? undefined,
        retry,
        status: snapshot.status === 'error' ? 'error' : 'connecting',
      };
}
