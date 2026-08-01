import type { ConnectionSource } from '@linkcode/client-core';
import { ConnectionController, LinkCodeClient } from '@linkcode/client-core';
import type { HostProfile } from '@mobile/stores/host-store';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createHostTransport } from './create-host-transport';
import { captureMobileProductEvent } from './product-analytics';

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
 * One host's connection lifecycle, on the shared {@link ConnectionController}: a dropped socket
 * recovers on its own with capped backoff, and regaining the network or returning to the foreground
 * cuts the remaining wait short instead of letting the user stare at a stale screen.
 *
 * `retrying` is reported as `connecting` — the distinction is in `attempt`, so a caller that only
 * branches on the three statuses needs no change. Callers must key this hook's component by
 * `host.id`; the render-time reset below is only a backstop.
 */
export function useHostClient(host: HostProfile): HostClientState {
  const [controller, setController] = useState(() => createController(host));

  const [trackedId, setTrackedId] = useState(host.id);
  if (trackedId !== host.id) {
    setTrackedId(host.id);
    setController(createController(host));
  }

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

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

function createController(host: HostProfile): ConnectionController<LinkCodeClient> {
  const source: ConnectionSource = {
    resolve: () => ({
      endpoint: 'url' in host ? host.url : host.tunnelHostId,
      transport: createHostTransport(host),
    }),
  };
  return new ConnectionController(source, {
    createClient: (transport) => new LinkCodeClient(transport, { randomUUID }),
    onOutcome(outcome) {
      captureMobileProductEvent(
        outcome.status === 'ready' ? 'host connection ready' : 'host connection failed',
        { duration_ms: outcome.durationMs },
      );
    },
    // ~13s of dialing (250·2ⁿ capped at 5s), then stop and surface `error`. Unbounded retries
    // would drain a phone in someone's pocket and never give up on a permanent failure — a wire
    // version mismatch cannot heal. The AppState/NetInfo triggers restart a run when something
    // actually changed, which is the only time another attempt can succeed.
    retry: { retries: 6 },
  });
}
