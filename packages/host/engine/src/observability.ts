import { Cause, Clock, Effect, Exit, Metric } from 'effect';

export type OperationOutcome = 'succeeded' | 'failed' | 'interrupted' | 'timed_out';

interface OperationObservability {
  readonly span: string;
  readonly subsystem: 'request' | 'session' | 'schedule' | 'loop' | 'process';
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
  readonly metricAttributes?: Readonly<Record<string, string>>;
  readonly successOutcome?: (value: unknown) => OperationOutcome;
  readonly failureOutcome?: (error: unknown) => OperationOutcome;
}

const outcomes = Metric.counter('linkcode_engine_operation_outcomes_total', {
  description: 'Engine control-plane operation outcomes',
});
const failures = Metric.counter('linkcode_engine_operation_failures_total', {
  description: 'Engine control-plane business failures',
});
const latency = Metric.histogram('linkcode_engine_operation_latency_ms', {
  description: 'Engine control-plane operation latency in milliseconds',
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 15000, 60000],
});
/** Adds a span and bounded-cardinality metrics without changing the effect's exit. */
export function observeOperation<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: OperationObservability,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    return yield* effect.pipe(
      Effect.onExit((exit) => {
        const outcome = outcomeOf(exit, options.successOutcome, options.failureOutcome);
        const attributes = {
          subsystem: options.subsystem,
          ...options.metricAttributes,
          outcome,
        };
        const updates: Array<Effect.Effect<void>> = [
          Metric.update(Metric.withAttributes(outcomes, attributes), 1),
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((endedAt) =>
              Metric.update(Metric.withAttributes(latency, attributes), endedAt - startedAt),
            ),
          ),
        ];
        if (outcome === 'failed' || outcome === 'timed_out') {
          updates.push(Metric.update(Metric.withAttributes(failures, attributes), 1));
        }
        return Effect.all(updates, { discard: true });
      }),
    );
  }).pipe(Effect.withSpan(options.span, { attributes: options.attributes }));
}

function outcomeOf<A, E>(
  exit: Exit.Exit<A, E>,
  successOutcome: OperationObservability['successOutcome'],
  failureOutcome: OperationObservability['failureOutcome'],
): OperationOutcome {
  if (Exit.isSuccess(exit)) return successOutcome?.(exit.value) ?? 'succeeded';
  if (Cause.hasInterruptsOnly(exit.cause)) return 'interrupted';
  return failureOutcome?.(Cause.squash(exit.cause)) ?? 'failed';
}
