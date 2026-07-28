import type { AgentRuntimes } from '@linkcode/schema';
import { Clock, Deferred, Effect, Semaphore } from 'effect';
import { OperationError } from '../failure';
import { jsonValueEqual } from '../json-equal';

const REVALIDATE_COOLDOWN_MS = 5000;

interface AgentRuntimeServiceOptions {
  readonly initial?: AgentRuntimes;
  readonly ready?: Promise<AgentRuntimes>;
  readonly collect?: () => Promise<AgentRuntimes>;
  readonly onChanged: (runtimes: AgentRuntimes) => void;
}

export class AgentRuntimeService {
  private runtimes: AgentRuntimes;
  private activeCollects = 0;
  private collectedAt = 0;
  private pendingEventCollect = false;
  private closed = false;

  private constructor(
    private readonly options: AgentRuntimeServiceOptions,
    private readonly readySignal: Deferred.Deferred<void>,
    private readonly semaphore: Semaphore.Semaphore,
    private readonly run: (effect: Effect.Effect<unknown>) => void,
  ) {
    this.runtimes = options.initial ?? {};
    if (options.ready) this.startSeed(options.ready);
  }

  static make(
    this: void,
    options: AgentRuntimeServiceOptions,
    run: (effect: Effect.Effect<unknown>) => void,
  ): Effect.Effect<AgentRuntimeService> {
    return Effect.gen(function* () {
      const readySignal = yield* Deferred.make<void>();
      const semaphore = yield* Semaphore.make(1);
      if (!options.ready) yield* Deferred.succeed(readySignal, undefined);

      return new AgentRuntimeService(options, readySignal, semaphore, run);
    });
  }

  snapshot(): Effect.Effect<AgentRuntimes> {
    return Deferred.await(this.readySignal).pipe(Effect.map(() => this.runtimes));
  }

  revalidate(): Effect.Effect<void> {
    return Clock.currentTimeMillis.pipe(
      Effect.tap((now) =>
        Effect.sync(() => {
          if (this.closed || !this.options.collect || this.activeCollects > 0) return;
          if (now - this.collectedAt < REVALIDATE_COOLDOWN_MS) return;
          this.enqueue(false);
        }),
      ),
      Effect.asVoid,
    );
  }

  refresh(): void {
    if (this.closed || !this.options.collect || this.pendingEventCollect) return;
    this.pendingEventCollect = true;
    this.enqueue(true, () => {
      this.pendingEventCollect = false;
    });
  }

  awaitReady(): Effect.Effect<void> {
    return Deferred.await(this.readySignal);
  }

  close(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.closed = true;
    }).pipe(Effect.andThen(Deferred.interrupt(this.readySignal)));
  }

  private startSeed(ready: Promise<AgentRuntimes>): void {
    this.activeCollects += 1;
    this.run(
      this.semaphore.withPermit(
        this.probe('agent-runtime.seed', 'Boot agent-runtime probe failed', () => ready).pipe(
          Effect.flatMap((runtimes) => this.commit(runtimes, true)),
          Effect.catch(reportProbeFailure),
          Effect.ensuring(
            Effect.sync(() => {
              this.activeCollects -= 1;
            }).pipe(Effect.andThen(Deferred.succeed(this.readySignal, undefined))),
          ),
        ),
      ),
    );
  }

  private enqueue(pushUnchanged: boolean, onStart?: () => void): void {
    const collect = this.options.collect;
    if (!collect || this.closed) return;
    this.activeCollects += 1;
    this.run(
      this.semaphore.withPermit(
        (onStart ? Effect.yieldNow.pipe(Effect.andThen(Effect.sync(onStart))) : Effect.void).pipe(
          Effect.andThen(
            this.probe('agent-runtime.collect', 'Re-probing agent runtimes failed', collect),
          ),
          Effect.flatMap((next) => this.commit(next, pushUnchanged)),
          Effect.catch(reportProbeFailure),
          Effect.ensuring(
            Effect.sync(() => {
              this.activeCollects -= 1;
            }),
          ),
        ),
      ),
    );
  }

  private commit(next: AgentRuntimes, pushUnchanged: boolean): Effect.Effect<void, OperationError> {
    return Clock.currentTimeMillis.pipe(
      Effect.flatMap((collectedAt) =>
        Effect.try({
          try: () => {
            if (this.closed) return;
            const changed = !jsonValueEqual(next, this.runtimes);
            this.runtimes = next;
            this.collectedAt = collectedAt;
            if (changed || pushUnchanged) this.options.onChanged(next);
          },
          catch: (cause) =>
            new OperationError({
              subsystem: 'runtime-probe',
              operation: 'agent-runtime.publish',
              publicMessage: 'Failed to publish agent runtimes',
              cause,
            }),
        }),
      ),
    );
  }

  private probe(
    operation: string,
    publicMessage: string,
    collect: () => Promise<AgentRuntimes>,
  ): Effect.Effect<AgentRuntimes, OperationError> {
    return Effect.tryPromise({
      try: collect,
      catch: (cause) =>
        new OperationError({
          subsystem: 'runtime-probe',
          operation,
          publicMessage,
          cause,
        }),
    });
  }
}

function reportProbeFailure(error: OperationError): Effect.Effect<void> {
  return Effect.logError(
    error.publicMessage,
    { operation: error.operation, subsystem: error.subsystem },
    error.cause,
  );
}
