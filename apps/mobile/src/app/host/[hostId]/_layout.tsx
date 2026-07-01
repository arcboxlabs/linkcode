import { LinkCodeProvider } from '@linkcode/client-core';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { HostConnectionState } from '../../../components/host-connection-state';
import { useHostClient } from '../../../runtime/use-host-client';
import type { HostProfile } from '../../../stores/host-store';
import { useHostRegistryStore } from '../../../stores/host-store';

/** Guard: resolve the host from the route param before any connection hooks run. */
export default function HostLayout(): React.ReactNode {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const host = useHostRegistryStore((state) => state.hosts.find((entry) => entry.id === hostId));

  if (!host) return <Redirect href="/connect" />;

  // Keyed by host id so switching hosts tears down the previous connection.
  return <HostConnection key={host.id} host={host} />;
}

function HostConnection({ host }: { host: HostProfile }): React.ReactNode {
  const { client, status, retry } = useHostClient(host.url);
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);

  useEffect(() => {
    setLastActiveHostId(host.id);
  }, [host.id, setLastActiveHostId]);

  if (status !== 'ready') {
    return <HostConnectionState status={status} url={host.url} onRetry={retry} />;
  }

  return (
    <LinkCodeProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </LinkCodeProvider>
  );
}
