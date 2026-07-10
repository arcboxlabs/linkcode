import { LinkCodeProvider } from '@linkcode/client-core';
import type { LinkCodeSdkClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { ComposeContextProvider } from 'foxact/compose-context-provider';
import { nullthrow } from 'foxact/nullthrow';
import { useEffect } from 'foxact/use-abortable-effect';
import { useSingleton } from 'foxact/use-singleton';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { trueFn } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type * as React from 'react';
import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { Cache, Middleware as SWRMiddleware } from 'swr';
import { SWRConfig, useSWRConfig } from 'swr';
import type {
  WorkbenchConnectionGeneration,
  WorkbenchConnectionSource,
  WorkbenchRuntimeStatus,
} from './connection-controller';
import { WorkbenchConnectionController } from './connection-controller';
import { useDebug } from './debug';
import { TayoriProvider } from './tayori';

interface WorkbenchRuntimeProviderBaseProps {
  /** Controller-only UI rendered before the first connection attempt can provide SDK contexts. */
  noGenerationFallback?: React.ReactNode;
}

export type WorkbenchRuntimeProviderProps = React.PropsWithChildren<
  WorkbenchRuntimeProviderBaseProps &
    (
      | { connectionSource: WorkbenchConnectionSource; transport?: never }
      | { connectionSource?: never; transport: Transport }
    )
>;

export interface WorkbenchConnectionGateProps extends React.PropsWithChildren {
  /** Renders instead of `children` while the transport is connecting or errored. */
  fallback: React.ReactNode;
}

const WorkbenchConnectionControllerContext = createContext<WorkbenchConnectionController | null>(
  null,
);
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
  const controller = useWorkbenchConnectionController();
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot().status,
    () => controller.getSnapshot().status,
  );
}

export function useWorkbenchRuntimeEndpoint(): string | undefined {
  const controller = useWorkbenchConnectionController();
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot().endpoint,
    () => controller.getSnapshot().endpoint,
  );
}

export function useWorkbenchRuntimeRetry(): () => void {
  return useWorkbenchConnectionController().retry;
}

export function useWorkbenchSdkClient(): LinkCodeSdkClient {
  return nullthrow(
    useContext(WorkbenchSdkClientContext),
    'useWorkbenchSdkClient must be used within WorkbenchRuntimeProvider',
  );
}

/**
 * Keeps the SWR cache and connection controller stable while remounting SDK, tayori, and raw-client
 * contexts together for each physical connection generation. Connection state does not gate those
 * contexts, so ungated surfaces remain mounted during recovery after the first generation exists.
 * Gating the main experience is `WorkbenchConnectionGate`'s job.
 */
export function WorkbenchRuntimeProvider(props: WorkbenchRuntimeProviderProps): React.ReactNode {
  const { children, noGenerationFallback = null } = props;
  const legacyTransport = 'transport' in props ? props.transport : null;
  const { current: legacyConnectionSource } = useSingleton<WorkbenchConnectionSource>(() => ({
    resolve: () => ({
      transport: nullthrow(
        legacyTransport,
        'WorkbenchRuntimeProvider requires a transport or connection source',
      ),
    }),
  }));
  const connectionSource =
    props.connectionSource !== undefined ? props.connectionSource : legacyConnectionSource;
  const { current: controller } = useSingleton(
    () => new WorkbenchConnectionController(connectionSource),
  );

  useEffect(() => {
    controller.setSource(connectionSource);
  }, [connectionSource, controller]);

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return (
    <WorkbenchConnectionControllerContext.Provider value={controller}>
      <WorkbenchEndpointCacheBoundary controller={controller}>
        <WorkbenchRuntimeGeneration
          controller={controller}
          noGenerationFallback={noGenerationFallback}
        >
          {children}
        </WorkbenchRuntimeGeneration>
      </WorkbenchEndpointCacheBoundary>
    </WorkbenchConnectionControllerContext.Provider>
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

function WorkbenchRuntimeGeneration({
  controller,
  children,
  noGenerationFallback,
}: React.PropsWithChildren<{
  controller: WorkbenchConnectionController;
  noGenerationFallback: React.ReactNode;
}>): React.ReactNode {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const { contextGeneration } = snapshot;
  if (!contextGeneration) return noGenerationFallback;

  return (
    <ComposeContextProvider
      key={contextGeneration.id}
      contexts={[
        <WorkbenchSdkClientContext.Provider key="sdk-client" value={contextGeneration.client} />,
        <TayoriProvider key="tayori" initClient={() => contextGeneration.client} />,
        <LinkCodeProvider key="linkcode" client={contextGeneration.client.raw} />,
      ]}
    >
      <ReadyRevalidator controller={controller} generation={contextGeneration}>
        {children}
      </ReadyRevalidator>
    </ComposeContextProvider>
  );
}

function ReadyRevalidator({
  children,
  controller,
  generation,
}: React.PropsWithChildren<{
  controller: WorkbenchConnectionController;
  generation: WorkbenchConnectionGeneration;
}>): React.ReactNode {
  const { mutate } = useSWRConfig();
  const revalidatedRef = useRef(false);
  const status = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot().status,
    () => controller.getSnapshot().status,
  );

  useEffect(() => {
    if (status !== 'ready' || revalidatedRef.current) return;
    revalidatedRef.current = true;
    void mutate(trueFn);
  }, [generation.id, mutate, status]);

  return children;
}

function WorkbenchEndpointCacheBoundary({
  children,
  controller,
}: React.PropsWithChildren<{
  controller: WorkbenchConnectionController;
}>): React.ReactNode {
  const endpoint = useSyncExternalStore(
    controller.subscribe,
    () => controller.getSnapshot().endpoint,
    () => controller.getSnapshot().endpoint,
  );
  return <WorkbenchSWRConfig key={endpoint ?? 'unscoped'}>{children}</WorkbenchSWRConfig>;
}

function WorkbenchSWRConfig({ children }: React.PropsWithChildren): React.ReactNode {
  const { current: cache } = useSingleton<Cache>(() => new Map());
  const { current: provider } = useSingleton(() => createCacheProvider(cache));
  return (
    <SWRConfig
      value={{
        keepPreviousData: true,
        onError: handleFetchError,
        provider,
        use: [debugMiddleware],
      }}
    >
      {children}
    </SWRConfig>
  );
}

function createCacheProvider(cache: Cache): () => Cache {
  return () => cache;
}

function handleFetchError(error: unknown): void {
  console.error('[LinkCode data error]', extractErrorMessage(error) ?? error);
}

function useWorkbenchConnectionController(): WorkbenchConnectionController {
  return nullthrow(
    useContext(WorkbenchConnectionControllerContext),
    'Workbench runtime hooks must be used within WorkbenchRuntimeProvider',
  );
}
