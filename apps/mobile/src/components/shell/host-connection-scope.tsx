import { HostConnectionContext, hostEndpointLabel } from '@mobile/runtime/host-connection';
import { useHostClient } from '@mobile/runtime/use-host-client';
import type { HostProfile } from '@mobile/stores/host-store';
import { useSelectedHost } from '@mobile/stores/host-store';
import { useMemo } from 'react';

/** Owns the connection to whichever host is selected, above the whole navigator: the tabs and the
 * screens that push over them are siblings in the route tree, so anything lower would dial once per
 * surface. Selecting a host is a store write, not a navigation — nothing re-routes to switch. */
export function HostConnectionScope({ children }: React.PropsWithChildren): React.ReactNode {
  const host = useSelectedHost();

  if (!host) return children;

  // Keyed by host id so switching hosts tears down the previous connection.
  return (
    <ConnectedScope key={host.id} host={host}>
      {children}
    </ConnectedScope>
  );
}

function ConnectedScope({
  host,
  children,
}: React.PropsWithChildren<{ host: HostProfile }>): React.ReactNode {
  const state = useHostClient(host);
  const connection = useMemo(
    () => ({ ...state, host, endpointLabel: hostEndpointLabel(host) }),
    [host, state],
  );

  return <HostConnectionContext value={connection}>{children}</HostConnectionContext>;
}
