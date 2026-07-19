import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Cause, Effect } from 'effect';
import { toRequestFailure } from '../failure';

export class WireResponder {
  constructor(private readonly transport: Transport) {}

  async tryReply(replyTo: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.sendFailure(replyTo, error);
    }
  }

  reply<E, R>(replyTo: string, effect: Effect.Effect<void, E, R>): Effect.Effect<void, never, R> {
    return effect.pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.sync(() => this.sendFailure(replyTo, Cause.squash(cause))),
      ),
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
