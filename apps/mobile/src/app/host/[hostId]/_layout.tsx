import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { HostConnectionContext, hostEndpointLabel } from '@mobile/runtime/host-connection';
import { useHostClient } from '@mobile/runtime/use-host-client';
import type { HostProfile } from '@mobile/stores/host-store';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';

/** Guard: resolve the host from the route param before any connection hooks run. */
export default function HostLayout(): React.ReactNode {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const host = useHostRegistryStore((state) => state.hosts.find((entry) => entry.id === hostId));

  if (!host) return <Redirect href="/connect" />;

  // Keyed by host id so switching hosts tears down the previous connection.
  return <HostConnection key={host.id} host={host} />;
}

/** The connection is owned here rather than by the tabs, so the detail screens that push over the
 * tab bar share it instead of dialing again. Gating happens per surface ({@link HostClientGate}). */
function HostConnection({ host }: { host: HostProfile }): React.ReactNode {
  const state = useHostClient(host);
  const screenOptions = useStackScreenOptions();
  const setLastActiveHostId = useHostRegistryStore((store) => store.setLastActiveHostId);

  useEffect(() => {
    setLastActiveHostId(host.id);
  }, [host.id, setLastActiveHostId]);

  const connection = useMemo(
    () => ({ ...state, host, endpointLabel: hostEndpointLabel(host) }),
    [host, state],
  );

  return (
    <HostConnectionContext value={connection}>
      <Stack screenOptions={screenOptions} />
    </HostConnectionContext>
  );
}
