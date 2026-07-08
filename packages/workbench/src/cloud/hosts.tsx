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
 * Online hosts for the signed-in cloud account. `accountKey` (a stable per-account identifier, e.g.
 * the account email) both gates the fetch — a falsy key means signed out, so the endpoint is never
 * hit — and scopes the cache. Scoping matters on a shared desktop: accounts can switch without a
 * renderer restart, and a constant key plus the provider-wide `keepPreviousData` would serve the
 * previous account's hosts to the next until revalidation. Keying by account and opting out of
 * `keepPreviousData` means an account change or sign-out shows a clean loading/empty state, never
 * another account's host list. Revalidates on focus and on a slow interval — presence changes
 * out-of-band as daemons connect and drop.
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
