import type { Transport, Unsubscribe } from '@linkcode/transport';
import type { AsyncRetryOptions } from 'foxts/async-retry';
import { asyncRetry } from 'foxts/async-retry';
import { noop } from 'foxts/noop';

const DEFAULT_RETRY_POLICY = {
  factor: 2,
  maxTimeout: 5000,
  minTimeout: 250,
} as const;

/** The lifecycle every transport-backed client exposes; both `LinkCodeClient` and the SDK's
 * wrapper satisfy it structurally, which is the whole reason this controller is generic. */
export interface RecoverableClient {
  connect(): Promise<void>;
  onClose(cb: (error: Error) => void): Unsubscribe;
  dispose(): void;
}

export interface ResolvedConnection {
  /** Human-readable endpoint used by connection-state UI. */
  endpoint?: string;
  /** A fresh physical connection. A source must not reuse closed transports. */
  transport: Transport;
}

/** App-owned endpoint resolution; the controller owns every resulting connection generation. */
export interface ConnectionSource {
  resolve(): ResolvedConnection;
  /** Invalidate even when the resolved endpoint string did not change. Also the hook for external
   * reconnect triggers — network regained, app foregrounded. */
  subscribe?(invalidate: () => void): Unsubscribe;
  /** App-specific work that must run only for a user-requested retry. */
  onExplicitRetry?(): void | Promise<void>;
}

export type ConnectionStatus = 'connecting' | 'ready' | 'retrying' | 'error';

export interface ConnectionGeneration<TClient> {
  readonly id: number;
  readonly client: TClient;
  readonly endpoint?: string;
  readonly transport: Transport;
}

export interface ConnectionSnapshot<TClient> {
  readonly status: ConnectionStatus;
  readonly endpoint?: string;
  readonly error?: unknown;
  readonly attempt: number;
  /** Stable React generation. A failed/closed generation can linger here after disposal; later
   * attempts stay private and replace this value only after reaching ready. */
  readonly contextGeneration: ConnectionGeneration<TClient> | null;
}

/** Reported once per recovery run, for analytics. */
export type ConnectionOutcome =
  | {
      readonly status: 'ready';
      readonly attempt: number;
      readonly durationMs: number;
      readonly recovered: boolean;
    }
  | { readonly status: 'failed'; readonly attempt: number; readonly durationMs: number };

export interface ConnectionControllerOptions<TClient> {
  createClient: (transport: Transport) => TClient;
  /** Called with each promoted generation's client, and with null once it is released. The SDK
   * consumer routes this to `setDefaultClient`; clients without an ambient default omit it. */
  onPromote?: (client: TClient | null) => void;
  onOutcome?: (outcome: ConnectionOutcome) => void;
  /** `retries` defaults to infinity — right for a local daemon that will eventually come back,
   * wrong for a battery-powered client, and wrong for a permanent failure such as a wire-protocol
   * mismatch. Cap it to surface `error` and let the caller re-trigger deliberately. */
  retry?: Partial<Pick<AsyncRetryOptions, 'factor' | 'maxTimeout' | 'minTimeout' | 'retries'>>;
}

interface ManagedGeneration<TClient> extends ConnectionGeneration<TClient> {
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
  readonly recovered: boolean;
  readonly startedAt: number;
  currentAttempt: number;
}

class ExplicitRetryError extends Error {
  override readonly name = 'ExplicitRetryError';

  constructor(readonly original: unknown) {
    super('Explicit connection retry failed', { cause: original });
  }
}

/**
 * Owns the complete transport/client lifecycle. React only subscribes to this store and mounts the
 * current generation's contexts; it does not participate in retry or close semantics.
 */
export class ConnectionController<TClient extends RecoverableClient> {
  private readonly listeners = new Set<() => void>();
  private readonly createClient: (transport: Transport) => TClient;
  private readonly onPromote: (client: TClient | null) => void;
  private readonly onOutcome: (outcome: ConnectionOutcome) => void;
  private readonly retryPolicy: AsyncRetryOptions;
  private snapshot: ConnectionSnapshot<TClient>;
  private activeGeneration: ManagedGeneration<TClient> | null = null;
  private contextGeneration: ManagedGeneration<TClient> | null = null;
  private promotedClient: TClient | null = null;
  private run: RecoveryRun | null = null;
  private offSource: Unsubscribe | null = null;
  private nextGenerationId = 0;
  private nextRunId = 0;
  private started = false;
  private disposed = false;
  private explicitHookPending = false;

  constructor(
    private source: ConnectionSource,
    options: ConnectionControllerOptions<TClient>,
  ) {
    this.createClient = options.createClient;
    this.onPromote = options.onPromote ?? noop;
    this.onOutcome = options.onOutcome ?? noop;
    this.retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      retries: Number.POSITIVE_INFINITY,
      ...options.retry,
      // Not overridable: recovery timing must stay deterministic for the tests that drive it.
      randomize: false,
    };
    this.snapshot = { attempt: 0, contextGeneration: null, status: 'connecting' };
  }

  readonly getSnapshot = (): ConnectionSnapshot<TClient> => this.snapshot;

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

  setSource(source: ConnectionSource): void {
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
      recovered: this.contextGeneration?.ready === true,
      startedAt: Date.now(),
      currentAttempt: 0,
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
      this.onOutcome({
        attempt: run.currentAttempt,
        durationMs: Date.now() - run.startedAt,
        status: 'failed',
      });
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
        run.currentAttempt = attempt;
        const source = this.source;
        if (attempt === 1 && run.explicit && source.onExplicitRetry) {
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
            return { client: this.createClient(resolved.transport), resolved };
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
    this.onOutcome({
      attempt: generation.attempt,
      durationMs: Date.now() - run.startedAt,
      recovered: run.recovered,
      status: 'ready',
    });
  }

  private async connectGeneration(
    run: RecoveryRun,
    attempt: number,
    resolved: ResolvedConnection,
    client: TClient,
  ): Promise<ManagedGeneration<TClient>> {
    run.abortController.signal.throwIfAborted();
    const generation: ManagedGeneration<TClient> = {
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

  private handleReadyClose(generation: ManagedGeneration<TClient>): void {
    if (generation !== this.activeGeneration || !this.started || this.disposed) return;
    this.startRecovery(false);
  }

  private replaceActiveGeneration(generation: ManagedGeneration<TClient>): void {
    this.releaseGeneration(this.activeGeneration);
    this.activeGeneration = generation;
  }

  private promoteGeneration(generation: ManagedGeneration<TClient>): void {
    this.contextGeneration = generation;
    this.promotedClient = generation.client;
    this.onPromote(generation.client);
  }

  private releaseGeneration(generation: ManagedGeneration<TClient> | null): void {
    if (!generation || generation.disposed) return;
    generation.disposed = true;
    generation.offClose();
    if (this.activeGeneration === generation) this.activeGeneration = null;
    if (this.promotedClient === generation.client) {
      this.promotedClient = null;
      this.onPromote(null);
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

  private publish(snapshot: ConnectionSnapshot<TClient>): void {
    if (!this.started || this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function unwrapConnectionError(error: unknown): unknown {
  return error instanceof ExplicitRetryError ? error.original : error;
}
