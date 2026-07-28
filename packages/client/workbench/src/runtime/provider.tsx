import { LinkCodeProvider } from '@linkcode/client-core';
import type { LinkCodeSdkClient } from '@linkcode/sdk';
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

export interface WorkbenchRuntimeProviderProps extends React.PropsWithChildren {
  connectionSource: WorkbenchConnectionSource;
  /** Controller-only UI rendered before the first connection attempt can provide SDK contexts. */
  noGenerationFallback?: React.ReactNode;
}

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
 * Keeps the SWR cache and connection controller stable while remounting the SDK/tayori/raw-client
 * contexts together per connection generation. Connection state does not gate those contexts
 * (ungated surfaces stay mounted during recovery); gating is `WorkbenchConnectionGate`'s job.
 */
export function WorkbenchRuntimeProvider({
  connectionSource,
  children,
  noGenerationFallback = null,
}: WorkbenchRuntimeProviderProps): React.ReactNode {
  const { current: controller } = useSingleton(() => {
    const controller = new WorkbenchConnectionController(connectionSource);
    // connectionSource is immutable across the entire app
    // so we just call it once during initialization here
    controller.setSource(connectionSource);
    return controller;
  });

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
  // eslint-disable-next-line no-console -- transport fetch failures need a diagnostic without interrupting the UI with a toast.
  console.error('[LinkCode data error]', extractErrorMessage(error) ?? error);
}

function useWorkbenchConnectionController(): WorkbenchConnectionController {
  return nullthrow(
    useContext(WorkbenchConnectionControllerContext),
    'Workbench runtime hooks must be used within WorkbenchRuntimeProvider',
  );
}
