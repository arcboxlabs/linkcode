import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { BrowserBrokerService } from './broker';

type BrowserRequest = Extract<
  WirePayload,
  {
    kind:
      | 'browser.host.register'
      | 'browser.host.detached'
      | 'browser.command.result'
      | 'browser.execute';
  }
>;

export class BrowserRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly broker: BrowserBrokerService,
  ) {}

  handle(payload: BrowserRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'browser.host.register':
        return Effect.sync(() => {
          this.broker.registerHost(payload.hostId);
        }).pipe(
          Effect.andThen(
            Effect.promise(() =>
              Promise.resolve(
                this.transport.send(
                  createWireMessage({ kind: 'request.succeeded', replyTo: payload.clientReqId }),
                ),
              ),
            ),
          ),
        );
      case 'browser.host.detached':
        return Effect.sync(() => this.broker.detachHost(payload.hostId));
      case 'browser.command.result':
        return Effect.sync(() => this.broker.settle(payload.commandId, payload.result));
      case 'browser.execute':
        return Effect.promise(() => this.broker.dispatch(payload.op, payload.args)).pipe(
          Effect.flatMap((result) =>
            Effect.promise(() =>
              Promise.resolve(
                this.transport.send(
                  createWireMessage({
                    kind: 'browser.executed',
                    replyTo: payload.clientReqId,
                    result,
                  }),
                ),
              ),
            ),
          ),
        );
      default:
        return Effect.void;
    }
  }
}
