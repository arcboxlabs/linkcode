import { createClient, setDefaultClient } from '@linkcode/sdk';
import type { LinkCodeSdkClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { createContextState } from 'foxact/context-state';
import { nullthrow } from 'foxact/nullthrow';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { wait } from 'foxts/wait';
import type * as React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Middleware as SWRMiddleware, SWRResponse } from 'swr';
import { SWRConfig } from 'swr';
import { useDebug } from './debug';
import { TayoriProvider } from './tayori';

export interface WorkbenchRuntimeProviderProps extends React.PropsWithChildren {
  transport: Transport;
  fallback: ReactNode;
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
const LOADING_OVERRIDE_EMPTY_VALUE = Object.freeze({});

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

export function WorkbenchRuntimeProvider(props: WorkbenchRuntimeProviderProps): ReactNode {
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
}: WorkbenchRuntimeProviderProps): ReactNode {
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
    <WorkbenchRuntimeControlsContext.Provider value={controls}>
      <WorkbenchSdkClientContext.Provider value={client}>
        <TayoriProvider initClient={() => client}>
          <WorkbenchSWRConfig>{children}</WorkbenchSWRConfig>
        </TayoriProvider>
      </WorkbenchSdkClientContext.Provider>
    </WorkbenchRuntimeControlsContext.Provider>
  );
}

function WorkbenchSWRConfig({ children }: React.PropsWithChildren): ReactNode {
  const debug = useDebug();
  const debugMiddleware: SWRMiddleware = (useSWRNext) => (key, fetcher, config) => {
    const wrappedFetcher =
      debug.enableArtificialDelay && typeof fetcher === 'function'
        ? async (...args: Parameters<NonNullable<typeof fetcher>>) => {
            await wait(500);
            return fetcher(...args);
          }
        : fetcher;
    // eslint-disable-next-line @eslint-react/rules-of-hooks, react-hooks/rules-of-hooks -- SWR middleware receives the next hook here by contract.
    const swr = useSWRNext(key, wrappedFetcher, config);

    return debug.isLoadingOverride ? createLoadingOverrideResponse(swr) : swr;
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

function createLoadingOverrideResponse<Data, Error>(
  swr: SWRResponse<Data, Error>,
): SWRResponse<Data, Error> {
  return Object.create(swr, {
    data: {
      configurable: true,
      enumerable: true,
      get: () =>
        Reflect.get(LOADING_OVERRIDE_EMPTY_VALUE, 'data') as SWRResponse<Data, Error>['data'],
    },
    error: {
      configurable: true,
      enumerable: true,
      get: () => Reflect.get(LOADING_OVERRIDE_EMPTY_VALUE, 'error'),
    },
    isLoading: {
      configurable: true,
      enumerable: true,
      get: () => true as SWRResponse<Data, Error>['isLoading'],
    },
    isValidating: {
      configurable: true,
      enumerable: true,
      get: () => true,
    },
  }) as SWRResponse<Data, Error>;
}
