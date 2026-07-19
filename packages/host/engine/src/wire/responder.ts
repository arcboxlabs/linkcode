import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Cause, Effect } from 'effect';
import { OperationError, OperationTimeout, RequestError, toRequestFailure } from '../failure';

export class WireResponder {
  constructor(private readonly transport: Transport) {}

  reply<E, R>(replyTo: string, effect: Effect.Effect<void, E, R>): Effect.Effect<void, never, R> {
    return effect.pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        const error = Cause.squash(cause);
        return reportFailure(error).pipe(
          Effect.andThen(Effect.sync(() => this.sendFailure(replyTo, error))),
        );
      }),
    );
  }

  sendFailure(replyTo: string, error: unknown): void {
    const { code, message } = toRequestFailure(error);
    this.transport.send(createWireMessage({ kind: 'request.failed', replyTo, code, message }));
  }

  sendSuccess(replyTo: string): void {
    this.transport.send(createWireMessage({ kind: 'request.succeeded', replyTo }));
  }
}

function reportFailure(error: unknown): Effect.Effect<void> {
  if (error instanceof RequestError) return Effect.void;
  if (error instanceof OperationError) {
    return Effect.logError(
      error.publicMessage,
      { operation: error.operation, subsystem: error.subsystem },
      error.cause,
    );
  }
  if (error instanceof OperationTimeout) {
    return Effect.logWarning(error.publicMessage, {
      operation: error.operation,
      duration: error.duration,
    });
  }
  return Effect.logError('Unexpected engine request failure', error);
}
