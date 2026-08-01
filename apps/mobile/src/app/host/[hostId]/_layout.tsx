import { LinkCodeProvider } from '@linkcode/client-core';
import { HostConnectionState } from '@mobile/components/host/host-connection-state';
import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { useHostClient } from '@mobile/runtime/use-host-client';
import type { HostProfile } from '@mobile/stores/host-store';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

/** Guard: resolve the host from the route param before any connection hooks run. */
export default function HostLayout(): React.ReactNode {
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const host = useHostRegistryStore((state) => state.hosts.find((entry) => entry.id === hostId));

  if (!host) return <Redirect href="/connect" />;

  // Keyed by host id so switching hosts tears down the previous connection.
  return <HostConnection key={host.id} host={host} />;
}

function HostConnection({ host }: { host: HostProfile }): React.ReactNode {
  const { client, status, retry, failure } = useHostClient(host);
  const screenOptions = useStackScreenOptions();
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);

  useEffect(() => {
    setLastActiveHostId(host.id);
  }, [host.id, setLastActiveHostId]);

  if (status !== 'ready') {
    return (
      <HostConnectionState
        status={status}
        url={'url' in host ? host.url : `${host.name} · LinkCode Cloud`}
        failure={failure}
        onRetry={retry}
      />
    );
  }

  return (
    <LinkCodeProvider client={client}>
      <Stack screenOptions={screenOptions} />
    </LinkCodeProvider>
  );
}
