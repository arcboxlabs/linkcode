import type { AgentAdapter } from '@linkcode/agent-adapter';
import type { AgentEvent, MessageId, StopReason } from '@linkcode/schema';
import { Cause, Deferred, Effect, Exit } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';

/** The outcome of one driven turn. */
export interface TurnResult {
  stopReason: StopReason;
  /** Concatenated assistant text of the turn's message segments (distinct bubbles joined by blank lines). */
  text: string;
}

function joinSegments(segments: Map<MessageId, string>): string {
  return Array.from(segments.values())
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/**
 * Drive one turn on a live adapter and resolve with its final assistant text and stop reason. Adds a
 * *second* `onEvent` listener (the adapter's Listeners set is multi-subscriber), leaving the engine's
 * own broadcast listener untouched. Subscribes *before* invoking `send`, since a fast provider can
 * emit the turn's events before the dispatch promise resolves.
 *
 * Rejects — never hangs — on an unrecoverable error event, an adapter `status: 'stopped'` (the turn
 * was torn down), a permission/question ask (this is an unattended run: cancel the turn and fail it),
 * a `send` rejection, or `opts.timeoutMs` elapsing. On every reject it best-effort cancels the turn so
 * the underlying session returns to idle. Interruption remains interruption and also cancels the turn.
 */
export function watchTurn(
  adapter: Pick<AgentAdapter, 'onEvent' | 'send'>,
  send: () => Promise<void>,
  opts: { timeoutMs?: number } = {},
): Effect.Effect<TurnResult, Error> {
  return Effect.gen(function* () {
    const segments = new Map<MessageId, string>();
    const outcome = yield* Deferred.make<TurnResult, Error>();
    const cancel = Effect.tryPromise({
      try: () => adapter.send({ type: 'cancel' }),
      catch: (cause) => cause,
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(
          'Failed to cancel automation turn',
          { operation: 'automation.turn.cancel', subsystem: 'agent' },
          Cause.squash(cause),
        ),
      ),
    );
    const turn = Effect.acquireUseRelease(
      Effect.sync(() =>
        adapter.onEvent((event: AgentEvent) => {
          switch (event.type) {
            case 'agent-message-chunk':
              if (event.content.type === 'text') {
                segments.set(
                  event.messageId,
                  (segments.get(event.messageId) ?? '') + event.content.text,
                );
              }
              break;
            case 'stop':
              Deferred.doneUnsafe(
                outcome,
                Effect.succeed({
                  stopReason: event.stopReason,
                  text: joinSegments(segments),
                }),
              );
              break;
            case 'status':
              // The turn was torn down without a `stop` (cancel, adapter shutdown).
              if (event.status === 'stopped') {
                Deferred.doneUnsafe(
                  outcome,
                  Effect.fail(new Error('session stopped before the turn finished')),
                );
              }
              break;
            case 'error':
              // Recoverable errors are surfaced to the client but the turn still settles on `stop`.
              if (!event.recoverable) {
                Deferred.doneUnsafe(outcome, Effect.fail(new Error(event.message)));
              }
              break;
            case 'permission-request':
              Deferred.doneUnsafe(
                outcome,
                Effect.fail(new Error(`waiting for permission: ${event.toolCall.title}`)),
              );
              break;
            case 'question-request':
              Deferred.doneUnsafe(outcome, Effect.fail(new Error('waiting for input')));
              break;
            default:
              break;
          }
        }),
      ),
      () =>
        Deferred.await(outcome).pipe(
          Effect.raceFirst(
            Effect.tryPromise({
              try: () => send(),
              catch: (error) =>
                new Error(extractErrorMessage(error) ?? 'failed to dispatch the turn'),
            }).pipe(Effect.andThen(Effect.never)),
          ),
        ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const timed =
      opts.timeoutMs === undefined
        ? turn
        : turn.pipe(
            Effect.timeoutOrElse({
              duration: opts.timeoutMs,
              orElse: () => Effect.fail(new Error(`turn timed out after ${opts.timeoutMs}ms`)),
            }),
          );

    return yield* timed.pipe(
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : cancel)),
    );
  });
}
