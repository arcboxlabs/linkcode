import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { EngineFailure } from '../failure';
import { RequestError, toOperationFailure } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { ScriptService } from './script-service';

type ScriptRequest = Extract<WirePayload, { kind: 'script.list' | 'script.start' | 'script.stop' }>;

/** Translates inbound script requests into operations on the optional host script service. */
export class ScriptRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly scripts: ScriptService | undefined,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: ScriptRequest): Effect.Effect<void> {
    const scripts = this.scripts;
    if (!scripts) {
      return this.responder.reply(
        payload.clientReqId,
        Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: 'Scripts are not supported on this host',
          }),
        ),
      );
    }

    switch (payload.kind) {
      case 'script.list':
        return this.responder.reply(
          payload.clientReqId,
          scriptOperation('script.list', 'Failed to list workspace scripts', () =>
            scripts.list(payload.cwd),
          ).pipe(
            Effect.flatMap((list) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'script.listed',
                    replyTo: payload.clientReqId,
                    scripts: list,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'script.start':
        return this.responder.reply(
          payload.clientReqId,
          scriptOperation('script.start', 'Failed to start workspace script', () =>
            scripts.start(payload.cwd, payload.scriptName),
          ).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'script.stop':
        return this.responder.reply(
          payload.clientReqId,
          syncScriptOperation('script.stop', 'Failed to stop workspace script', () =>
            scripts.stop(payload.cwd, payload.scriptName),
          ).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      default:
        return Effect.void;
    }
  }
}

function scriptOperation<A>(
  operation: string,
  publicMessage: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, EngineFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem: 'script', operation, publicMessage }),
  });
}

function syncScriptOperation(
  operation: string,
  publicMessage: string,
  run: () => void,
): Effect.Effect<void, EngineFailure> {
  return Effect.try({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem: 'script', operation, publicMessage }),
  });
}
