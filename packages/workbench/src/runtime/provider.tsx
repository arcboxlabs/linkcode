import type { LinkCodeSdkClient } from '@linkcode/sdk';
import { createClient, setDefaultClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { ComposeContextProvider } from 'foxact/compose-context-provider';
import { createContextState } from 'foxact/context-state';
import { nullthrow } from 'foxact/nullthrow';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { wait } from 'foxts/wait';
import type * as React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Middleware as SWRMiddleware } from 'swr';
import { SWRConfig } from 'swr';
import { useDebug } from './debug';
import { TayoriProvider } from './tayori';

export interface WorkbenchRuntimeProviderProps extends React.PropsWithChildren {
  transport: Transport;
  fallback: React.ReactNode;
}

export type WorkbenchRuntimeStatus = 'connecting' | 'ready' | 'error';

interface WorkbenchRuntimeControls {
  retry: () => void;
}

const [
  WorkbenchRuntimeStatusProvider,
  useWorkbenchRuntimeStatusValue,
  useSetWorkbenchRuntimeStatus,
] = createContextState<WorkbenchRuntimeStatus>('connecting');

const WorkbenchRuntimeControlsContext = createContext<WorkbenchRuntimeControls | null>(null);
const WorkbenchSdkClientContext = createContext<LinkCodeSdkClient | null>(null);

const debugMiddleware: SWRMiddleware = (useSWRNext) =>
  function useDebugSWRMiddleware(key, fetcher, config) {
    const { enableArtificialDelay, isLoadingOverride } = useDebug();
    const wrappedFetcher =
      enableArtificialDelay && typeof fetcher === 'function'
        ? async (...args: Parameters<NonNullable<typeof fetcher>>) => {
            await wait(500);
            return fetcher(...args);
          }
        : fetcher;

    const swr = useSWRNext(key, wrappedFetcher, config);

    if (isLoadingOverride) {
      return {
        ...swr,
        data: undefined,
        error: undefined,
        isLoading: true,
        isValidating: true,
      };
    }

    return swr;
  };

export function useWorkbenchRuntimeStatus(): WorkbenchRuntimeStatus {
  return useWorkbenchRuntimeStatusValue();
}

export function useWorkbenchRuntimeRetry(): () => void {
  return nullthrow(
    useContext(WorkbenchRuntimeControlsContext),
    'useWorkbenchRuntimeRetry must be used within WorkbenchRuntimeProvider',
  ).retry;
}

export function useWorkbenchSdkClient(): LinkCodeSdkClient {
  return nullthrow(
    useContext(WorkbenchSdkClientContext),
    'useWorkbenchSdkClient must be used within WorkbenchRuntimeProvider',
  );
}

export function WorkbenchRuntimeProvider(props: WorkbenchRuntimeProviderProps): React.ReactNode {
  return (
    <WorkbenchRuntimeStatusProvider>
      <WorkbenchRuntimeConnection {...props} />
    </WorkbenchRuntimeStatusProvider>
  );
}

function WorkbenchRuntimeConnection({
  transport,
  children,
  fallback,
}: WorkbenchRuntimeProviderProps): React.ReactNode {
  const [client, setClient] = useState(() => createClient({ transport }));
  const status = useWorkbenchRuntimeStatus();
  const setStatus = useSetWorkbenchRuntimeStatus();
  const retry = useCallback(() => {
    setStatus('connecting');
    setClient(createClient({ transport }));
  }, [setStatus, transport]);
  const controls = useMemo<WorkbenchRuntimeControls>(() => ({ retry }), [retry]);

  useEffect(
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
    [client, setStatus],
  );

  if (status !== 'ready') {
    return (
      <WorkbenchRuntimeControlsContext.Provider value={controls}>
        {fallback}
      </WorkbenchRuntimeControlsContext.Provider>
    );
  }

  return (
    <ComposeContextProvider
      contexts={[
        <WorkbenchRuntimeControlsContext.Provider key="runtime-controls" value={controls} />,
        <WorkbenchSdkClientContext.Provider key="sdk-client" value={client} />,
        <TayoriProvider key="tayori" initClient={() => client} />,
        <WorkbenchSWRConfig key="swr" />,
      ]}
    >
      {children}
    </ComposeContextProvider>
  );
}

function WorkbenchSWRConfig({ children }: React.PropsWithChildren): React.ReactNode {
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
