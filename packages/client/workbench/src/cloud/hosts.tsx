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
 * Online hosts for the signed-in cloud account. `accountKey` gates the fetch (falsy = signed out,
 * endpoint never hit) and scopes the cache: accounts can switch without a renderer restart, and a
 * constant key plus `keepPreviousData` would serve the previous account's hosts to the next.
 * Revalidates on focus and on a slow interval — presence changes out-of-band.
 */
export function useCloudHosts(accountKey: string | null | undefined): SWRResponse<CloudHost[]> {
  const source = use(CloudHostsSourceContext);
  return useSWR<CloudHost[]>(
    accountKey && source ? [CLOUD_HOSTS_KEY, accountKey] : null,
    source ?? null,
    {
      revalidateOnFocus: true,
      refreshInterval: 30000,
      keepPreviousData: false,
    },
  );
}
