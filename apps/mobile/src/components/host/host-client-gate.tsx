import { LinkCodeProvider } from '@linkcode/client-core';
import { HostConnectionState } from '@mobile/components/host/host-connection-state';
import { useHostConnection } from '@mobile/runtime/host-connection';
import { Redirect } from 'expo-router';

/** Renders its children only once the host connection is ready, and the connecting/failed state
 * otherwise. Each surface that needs the client gates itself, so the Settings tab — which is where
 * "Manage hosts" lives — stays reachable while the host is unreachable. */
export function HostClientGate({ children }: React.PropsWithChildren): React.ReactNode {
  const connection = useHostConnection();

  // Reachable by removing the selected host while standing in a tab, not just at startup.
  if (!connection) return <Redirect href="/connect" />;

  if (connection.status !== 'ready') {
    return (
      <HostConnectionState
        status={connection.status}
        url={connection.endpointLabel}
        failure={connection.failure}
        onRetry={connection.retry}
      />
    );
  }

  return <LinkCodeProvider client={connection.client}>{children}</LinkCodeProvider>;
}
