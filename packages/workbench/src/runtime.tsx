import { createClient, type LinkCodeSdkClient, setDefaultClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import type { Middleware as SWRMiddleware } from 'swr';
import { SWRConfig } from 'swr';
import { useDebug } from './debug';
import { TayoriProvider } from './tayori';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface WorkbenchRuntimeProviderProps {
  transport: Transport;
  children: (client: LinkCodeSdkClient) => ReactNode;
  fallback: (status: 'connecting' | 'error') => ReactNode;
}

export function WorkbenchRuntimeProvider({
  transport,
  children,
  fallback,
}: WorkbenchRuntimeProviderProps): ReactElement {
  const [client] = useState(() => createClient({ transport }));
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');

  useEffect(() => {
    let alive = true;
    setDefaultClient(client);
    client
      .connect()
      .then(() => {
        if (alive) setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });

    return () => {
      alive = false;
      setDefaultClient(null);
      client.dispose();
    };
  }, [client]);

  if (status !== 'ready') return <>{fallback(status)}</>;

  return (
    <TayoriProvider initClient={() => client}>
      <WorkbenchSWRConfig>{children(client)}</WorkbenchSWRConfig>
    </TayoriProvider>
  );
}

function WorkbenchSWRConfig({ children }: { children: ReactNode }): ReactElement {
  const debug = useDebug();
  const debugMiddleware: SWRMiddleware = (useSWRNext) => (key, fetcher, config) => {
    const wrappedFetcher =
      debug.enableArtificialDelay && typeof fetcher === 'function'
        ? async (...args: Parameters<NonNullable<typeof fetcher>>) => {
            await wait(500);
            return fetcher(...args);
          }
        : fetcher;
    // biome-ignore lint/correctness/useHookAtTopLevel: SWR middleware receives the next hook here by contract.
    const swr = useSWRNext(key, wrappedFetcher, config);

    if (!debug.isLoadingOverride) return swr;

    return {
      ...swr,
      data: undefined,
      error: undefined,
      isLoading: true,
      isValidating: true,
    };
  };

  return (
    <SWRConfig
      value={{
        keepPreviousData: true,
        onError: handleFetchError,
        use: [debugMiddleware],
      }}
    >
      {children}
    </SWRConfig>
  );
}

function handleFetchError(error: unknown): void {
  if (error instanceof Error) {
    console.error('[LinkCode data error]', error.message, error);
    return;
  }
  console.error('[LinkCode data error]', error);
}
