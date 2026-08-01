import { HostConnectionContext, hostEndpointLabel } from '@mobile/runtime/host-connection';
import { connectionFor, pruneConnections } from '@mobile/runtime/host-connection-pool';
import { useHostClient } from '@mobile/runtime/use-host-client';
import { useHostRegistryStore, useSelectedHost } from '@mobile/stores/host-store';
import { useSettingsStore } from '@mobile/stores/settings-store';
import { useEffect, useMemo } from 'react';

/** Publishes the selected host's connection above the whole navigator: the tabs and the screens
 * that push over them are siblings in the route tree, so anything lower would dial once per
 * surface. Selecting a host is a store write, not a navigation — nothing re-routes to switch.
 *
 * Which connections survive a switch is the user's call. Off (the default), only the selected host
 * stays dialed. On, every saved host does, so switching back is a subscription rather than a
 * handshake — paid for in sockets. */
export function HostConnectionScope({ children }: React.PropsWithChildren): React.ReactNode {
  const host = useSelectedHost();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const keepHostsConnected = useSettingsStore((state) => state.keepHostsConnected);

  // Warms whatever qualifies and drops what no longer does — a host removed from the registry, or
  // every other host the moment the preference goes off.
  useEffect(() => {
    const keep = new Set(
      keepHostsConnected ? hosts.map((entry) => entry.id) : host ? [host.id] : [],
    );
    for (const entry of hosts) if (keep.has(entry.id)) connectionFor(entry);
    pruneConnections(keep);
  }, [host, hosts, keepHostsConnected]);

  if (!host) return children;

  return <ConnectedScope host={host}>{children}</ConnectedScope>;
}

/** Deliberately unkeyed: `useHostClient` swaps to the new host's pooled connection in place, so
 * switching does not remount the navigator and lose the tab you were standing in. */
function ConnectedScope({
  host,
  children,
}: React.PropsWithChildren<{ host: NonNullable<ReturnType<typeof useSelectedHost>> }>) {
  const state = useHostClient(host);
  const connection = useMemo(
    () => ({ ...state, host, endpointLabel: hostEndpointLabel(host) }),
    [host, state],
  );

  return <HostConnectionContext value={connection}>{children}</HostConnectionContext>;
}
