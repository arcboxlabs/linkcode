import type { LinkCodeSdkClient } from '@linkcode/sdk';
import { createClient, setDefaultClient } from '@linkcode/sdk';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import type { AsyncRetryOptions } from 'foxts/async-retry';
import { asyncRetry } from 'foxts/async-retry';
import { noop } from 'foxts/noop';

const DEFAULT_RETRY_POLICY = {
  factor: 2,
  maxTimeout: 5000,
  minTimeout: 250,
} as const;

export interface ResolvedWorkbenchConnection {
  /** Human-readable endpoint used by connection-state UI. */
  endpoint?: string;
  /** A fresh physical connection. A source must not reuse closed transports. */
  transport: Transport;
}

/** App-owned endpoint resolution; Workbench owns every resulting connection generation. */
export interface WorkbenchConnectionSource {
  resolve(): ResolvedWorkbenchConnection;
  /** Invalidate even when the resolved endpoint string did not change. */
  subscribe?(invalidate: () => void): Unsubscribe;
  /** App-specific work that must run only for a user-requested retry. */
  onExplicitRetry?(): void | Promise<void>;
}

export type WorkbenchRuntimeStatus = 'connecting' | 'ready' | 'retrying' | 'error';

export interface WorkbenchConnectionGeneration {
  readonly id: number;
  readonly client: LinkCodeSdkClient;
  readonly endpoint?: string;
  readonly transport: Transport;
}

export interface WorkbenchConnectionSnapshot {
  readonly status: WorkbenchRuntimeStatus;
  readonly endpoint?: string;
  readonly error?: unknown;
  readonly attempt: number;
  /**
   * Stable React context generation. A failed/closed generation can remain here after its client
   * has been disposed; it is no longer active or installed as the SDK default. Later attempts stay
   * private and replace this value only after reaching ready.
   */
  readonly contextGeneration: WorkbenchConnectionGeneration | null;
}

interface ManagedGeneration extends WorkbenchConnectionGeneration {
  readonly attempt: number;
  closed: boolean;
  disposed: boolean;
  ready: boolean;
  offClose: Unsubscribe;
}

interface RecoveryRun {
  readonly id: number;
  readonly abortController: AbortController;
  readonly explicit: boolean;
}

interface WorkbenchConnectionControllerOptions {
  createClient?: (transport: Transport) => LinkCodeSdkClient;
  retry?: Partial<Pick<AsyncRetryOptions, 'factor' | 'maxTimeout' | 'minTimeout'>>;
}

class ExplicitRetryError extends Error {
  override readonly name = 'ExplicitRetryError';

  constructor(readonly original: unknown) {
    super('Explicit connection retry failed', { cause: original });
  }
}

const INITIAL_SNAPSHOT: WorkbenchConnectionSnapshot = {
  attempt: 0,
  contextGeneration: null,
  status: 'connecting',
};

/**
 * Owns the complete transport/SDK lifecycle. React only subscribes to this store and mounts the
 * current generation's contexts; it does not participate in retry or close semantics.
 */
export class WorkbenchConnectionController {
  private readonly listeners = new Set<() => void>();
  private readonly createSdkClient: (transport: Transport) => LinkCodeSdkClient;
  private readonly retryPolicy: AsyncRetryOptions;
  private snapshot: WorkbenchConnectionSnapshot = INITIAL_SNAPSHOT;
  private activeGeneration: ManagedGeneration | null = null;
  private contextGeneration: ManagedGeneration | null = null;
  private defaultClient: LinkCodeSdkClient | null = null;
  private run: RecoveryRun | null = null;
  private offSource: Unsubscribe | null = null;
  private nextGenerationId = 0;
  private nextRunId = 0;
  private started = false;
  private disposed = false;
  private explicitHookPending = false;

  constructor(
    private source: WorkbenchConnectionSource,
    options: WorkbenchConnectionControllerOptions = {},
  ) {
    this.createSdkClient = options.createClient ?? ((transport) => createClient({ transport }));
    this.retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...options.retry,
      randomize: false,
      retries: Number.POSITIVE_INFINITY,
    };
  }

  readonly getSnapshot = (): WorkbenchConnectionSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.offSource = this.source.subscribe?.(() => this.invalidate()) ?? null;
    this.startRecovery(false);
  }

  /** Stop all work while allowing React StrictMode to start the same instance again. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.offSource?.();
    this.offSource = null;
    this.cancelRecovery();
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
  }

  setSource(source: WorkbenchConnectionSource): void {
    if (source === this.source || this.disposed) return;
    this.offSource?.();
    this.offSource = null;
    this.source = source;
    if (!this.started) return;
    this.offSource = source.subscribe?.(() => this.invalidate()) ?? null;
    this.startRecovery(false);
  }

  readonly retry = (): void => {
    if (!this.started || this.disposed) return;
    if (this.explicitHookPending) return;
    this.startRecovery(true);
  };

  private invalidate(): void {
    if (!this.started || this.disposed) return;
    this.startRecovery(false);
  }

  private startRecovery(explicit: boolean): void {
    this.cancelRecovery();
    const run: RecoveryRun = {
      abortController: new AbortController(),
      explicit,
      id: ++this.nextRunId,
    };
    this.run = run;
    this.publish({
      ...this.snapshot,
      attempt: 0,
      error: undefined,
      status: 'connecting',
    });

    void this.recover(run).catch((error: unknown) => {
      if (!this.isCurrent(run) || run.abortController.signal.aborted) return;
      this.publish({
        ...this.snapshot,
        error: unwrapConnectionError(error),
        status: 'error',
      });
    });
  }

  private async recover(run: RecoveryRun): Promise<void> {
    const generation = await asyncRetry(
      async (bail, attempt) => {
        const source = this.source;
        if (run.explicit && attempt === 1 && source.onExplicitRetry) {
          this.explicitHookPending = true;
          try {
            await source.onExplicitRetry();
          } catch (error) {
            throw new ExplicitRetryError(error);
          } finally {
            this.explicitHookPending = false;
          }
        }
        run.abortController.signal.throwIfAborted();
        if (!this.isCurrent(run)) throw run.abortController.signal.reason;

        const { resolved, client } = (() => {
          try {
            const resolved = this.source.resolve();
            return { client: this.createSdkClient(resolved.transport), resolved };
          } catch (error) {
            return bail(error);
          }
        })();
        return this.connectGeneration(run, attempt, resolved, client);
      },
      {
        ...this.retryPolicy,
        onFailedAttempt: ({ attemptNumber, error }) => {
          if (!this.isCurrent(run)) return;
          this.publish({
            ...this.snapshot,
            attempt: attemptNumber,
            error: unwrapConnectionError(error),
            status: 'retrying',
          });
        },
        signal: run.abortController.signal,
      },
    );

    if (!this.isCurrent(run) || run.abortController.signal.aborted) {
      this.releaseGeneration(generation);
      return;
    }
    this.promoteGeneration(generation);
    this.publish({
      attempt: generation.attempt,
      contextGeneration: generation,
      endpoint: generation.endpoint,
      error: undefined,
      status: 'ready',
    });
  }

  private async connectGeneration(
    run: RecoveryRun,
    attempt: number,
    resolved: ResolvedWorkbenchConnection,
    client: LinkCodeSdkClient,
  ): Promise<ManagedGeneration> {
    run.abortController.signal.throwIfAborted();
    const generation: ManagedGeneration = {
      attempt,
      client,
      closed: false,
      disposed: false,
      endpoint: resolved.endpoint,
      id: ++this.nextGenerationId,
      offClose: noop,
      ready: false,
      transport: resolved.transport,
    };
    this.replaceActiveGeneration(generation);
    if (this.contextGeneration === null) this.contextGeneration = generation;

    let rejectClose!: (error: Error) => void;
    const closePromise = new Promise<never>((_resolve, reject) => {
      rejectClose = reject;
    });
    generation.offClose = client.onClose((error) => {
      if (generation.closed || generation.disposed) return;
      generation.closed = true;
      rejectClose(error);
      if (generation.ready) this.handleReadyClose(generation);
    });

    this.publish({
      attempt,
      contextGeneration: this.contextGeneration,
      endpoint: resolved.endpoint,
      error: attempt === 1 ? undefined : this.snapshot.error,
      status: attempt === 1 ? 'connecting' : 'retrying',
    });

    const signal = run.abortController.signal;
    let rejectAbort!: (reason: unknown) => void;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = (): void => rejectAbort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await Promise.race([client.connect(), closePromise, abortPromise]);
      signal.throwIfAborted();
      if (!this.isCurrent(run) || generation.closed) {
        throw new Error('connection generation superseded');
      }
      generation.ready = true;
      return generation;
    } catch (error) {
      this.releaseGeneration(generation);
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private handleReadyClose(generation: ManagedGeneration): void {
    if (generation !== this.activeGeneration || !this.started || this.disposed) return;
    this.startRecovery(false);
  }

  private replaceActiveGeneration(generation: ManagedGeneration): void {
    this.releaseGeneration(this.activeGeneration);
    this.activeGeneration = generation;
  }

  private promoteGeneration(generation: ManagedGeneration): void {
    this.contextGeneration = generation;
    this.defaultClient = generation.client;
    setDefaultClient(generation.client);
  }

  private releaseGeneration(generation: ManagedGeneration | null): void {
    if (!generation || generation.disposed) return;
    generation.disposed = true;
    generation.offClose();
    if (this.activeGeneration === generation) this.activeGeneration = null;
    if (this.defaultClient === generation.client) {
      this.defaultClient = null;
      setDefaultClient(null);
    }
    generation.client.dispose();
  }

  private cancelRecovery(): void {
    const run = this.run;
    this.run = null;
    run?.abortController.abort();
    this.releaseGeneration(this.activeGeneration);
  }

  private isCurrent(run: RecoveryRun): boolean {
    return this.started && !this.disposed && this.run?.id === run.id;
  }

  private publish(snapshot: WorkbenchConnectionSnapshot): void {
    if (!this.started || this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function unwrapConnectionError(error: unknown): unknown {
  return error instanceof ExplicitRetryError ? error.original : error;
}
