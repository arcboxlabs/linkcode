import type { LinkCodeSdkClient } from '@linkcode/sdk';
import { createClient, setDefaultClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { ComposeContextProvider } from 'foxact/compose-context-provider';
import { createContextState } from 'foxact/context-state';
import { nullthrow } from 'foxact/nullthrow';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { trueFn } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type * as React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Middleware as SWRMiddleware } from 'swr';
import { SWRConfig, mutate as swrMutate } from 'swr';
import { useDebug } from './debug';
import { TayoriProvider } from './tayori';

export interface WorkbenchRuntimeProviderProps extends React.PropsWithChildren {
  transport: Transport;
}

export interface WorkbenchConnectionGateProps extends React.PropsWithChildren {
  /** Renders instead of `children` while the transport is connecting or errored. */
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
      // Avoid spreading `swr`: SWRResponse fields are tracked getters, and spreading
      // reads (subscribes to) all of them, defeating per-field re-render optimization.
      return {
        mutate: swr.mutate,
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

/**
 * Mounts the data-plane contexts (SDK client, tayori, SWR) unconditionally — connection state
 * does NOT gate them, so ungated surfaces (desktop Settings) can fetch while the transport is
 * still connecting or down (their requests fail or pend until it is ready). Gating the main
 * experience is `WorkbenchConnectionGate`'s job.
 */
export function WorkbenchRuntimeProvider(props: WorkbenchRuntimeProviderProps): React.ReactNode {
  return (
    <WorkbenchRuntimeStatusProvider>
      <WorkbenchRuntimeConnection {...props} />
    </WorkbenchRuntimeStatusProvider>
  );
}

/**
 * The connection gate, separated from the runtime contexts: renders `fallback` until the
 * transport is ready. Mount it around everything that assumes a connected daemon.
 */
export function WorkbenchConnectionGate({
  fallback,
  children,
}: WorkbenchConnectionGateProps): React.ReactNode {
  const status = useWorkbenchRuntimeStatus();
  return status === 'ready' ? children : fallback;
}

function WorkbenchRuntimeConnection({
  transport,
  children,
}: WorkbenchRuntimeProviderProps): React.ReactNode {
  // tayori's initClient runs exactly once per TayoriProvider mount (see the tayori docs), so a
  // retry that swaps the client must remount the whole context stack — hence the epoch key.
  const [clientState, setClientState] = useState(() => ({
    client: createClient({ transport }),
    epoch: 0,
  }));
  const { client, epoch } = clientState;
  const setStatus = useSetWorkbenchRuntimeStatus();
  const retry = useCallback(() => {
    setStatus('connecting');
    setClientState((previous) => ({
      client: createClient({ transport }),
      epoch: previous.epoch + 1,
    }));
  }, [setStatus, transport]);
  const controls = useMemo<WorkbenchRuntimeControls>(() => ({ retry }), [retry]);

  useEffect(
    (signal) => {
      setDefaultClient(client);
      setStatus('connecting');
      client
        .connect()
        .then(() => {
          if (signal.aborted) return;
          setStatus('ready');
          // Ungated surfaces may hold requests that failed pre-connect in SWR error-backoff —
          // kick every key now instead of waiting the backoff out. Gated children mount fresh
          // and are unaffected; the SWRConfig below shares the default cache, so the global
          // mutate reaches these keys.
          void swrMutate(trueFn);
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

  return (
    <ComposeContextProvider
      key={epoch}
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
