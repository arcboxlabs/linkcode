import { LinkCodeProvider } from '@linkcode/client-core';
import { HostConnectionState } from '@mobile/components/host/host-connection-state';
import { useHostConnection } from '@mobile/runtime/host-connection';

/** Renders its children only once the host connection is ready, and the connecting/failed state
 * otherwise. Each surface that needs the client gates itself, so the Settings tab — which is where
 * "Manage hosts" lives — stays reachable while the host is unreachable. */
export function HostClientGate({ children }: React.PropsWithChildren): React.ReactNode {
  const { client, status, retry, failure, endpointLabel } = useHostConnection();

  if (status !== 'ready') {
    return (
      <HostConnectionState status={status} url={endpointLabel} failure={failure} onRetry={retry} />
    );
  }

  return <LinkCodeProvider client={client}>{children}</LinkCodeProvider>;
}
