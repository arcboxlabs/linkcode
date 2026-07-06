import { createContext, use } from 'react';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import type { CloudHost, CloudHostsSource } from './types';

const CloudHostsSourceContext = createContext<CloudHostsSource | null>(null);

/**
 * Supplies the online-hosts fetcher to the data plane. The app owns the source (desktop reads the
 * keychain session in main and exposes a bridge); workbench owns the SWR lifecycle around it.
 */
export function CloudHostsProvider({
  source,
  children,
}: {
  source: CloudHostsSource;
  children: React.ReactNode;
}): React.ReactNode {
  return <CloudHostsSourceContext value={source}>{children}</CloudHostsSourceContext>;
}

const CLOUD_HOSTS_KEY = 'cloud/tunnel/hosts';

/**
 * Online hosts for the signed-in cloud account. `enabled` gates the fetch on the caller's session so
 * signed-out shells never hit the endpoint. Revalidates on focus and on a slow interval — presence
 * changes out-of-band as daemons connect and drop.
 */
export function useCloudHosts(enabled: boolean): SWRResponse<CloudHost[]> {
  const source = use(CloudHostsSourceContext);
  return useSWR<CloudHost[]>(enabled && source ? CLOUD_HOSTS_KEY : null, source ?? null, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
  });
}
