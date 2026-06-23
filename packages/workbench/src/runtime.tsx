import { createClient, type LinkCodeSdkClient, setDefaultClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { wait } from 'foxts/wait';
import { createContext, type ReactElement, type ReactNode, useContext, useState } from 'react';
import type { Middleware as SWRMiddleware } from 'swr';
import { SWRConfig } from 'swr';
import { useDebug } from './debug';
import { TayoriProvider } from './tayori';

export interface WorkbenchRuntimeProviderProps {
  transport: Transport;
  children: ReactNode;
  fallback: (status: 'connecting' | 'error') => ReactNode;
}

const WorkbenchSdkClientContext = createContext<LinkCodeSdkClient | null>(null);

export function useWorkbenchSdkClient(): LinkCodeSdkClient {
  const client = useContext(WorkbenchSdkClientContext);
  if (!client)
    throw new Error('useWorkbenchSdkClient must be used within WorkbenchRuntimeProvider');
  return client;
}

export function WorkbenchRuntimeProvider({
  transport,
  children,
  fallback,
}: WorkbenchRuntimeProviderProps): ReactElement {
  const [client] = useState(() => createClient({ transport }));
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');

  useAbortableEffect(
    (signal) => {
      setDefaultClient(client);
      setStatus('connecting');
      client
        .connect()
        .then(() => {
          if (!signal.aborted) setStatus('ready');
        })
        .catch(() => {
          if (!signal.aborted) setStatus('error');
        });

      return () => {
        setDefaultClient(null);
        client.dispose();
      };
    },
    [client],
  );

  if (status !== 'ready') return <>{fallback(status)}</>;

  return (
    <WorkbenchSdkClientContext.Provider value={client}>
      <TayoriProvider initClient={() => client}>
        <WorkbenchSWRConfig>{children}</WorkbenchSWRConfig>
      </TayoriProvider>
    </WorkbenchSdkClientContext.Provider>
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
  console.error('[LinkCode data error]', extractErrorMessage(error) ?? error);
}
