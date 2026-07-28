import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { RequestError } from '../failure';
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
          scripts.list(payload.cwd).pipe(
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
          scripts
            .start(payload.cwd, payload.scriptName)
            .pipe(
              Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      case 'script.stop':
        return this.responder.reply(
          payload.clientReqId,
          scripts
            .stop(payload.cwd, payload.scriptName)
            .pipe(
              Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      default:
        return Effect.void;
    }
  }
}
