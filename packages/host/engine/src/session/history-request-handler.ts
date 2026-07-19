import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { WireResponder } from '../wire/responder';
import type { HistoryService } from './history-service';
import type { SessionLifecycleService } from './lifecycle-service';

type HistoryRequest = Extract<
  WirePayload,
  { kind: 'history.list' | 'history.read' | 'history.resume' }
>;

/** Translates provider-history requests into cached reads and session lifecycle operations. */
export class HistoryRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly history: HistoryService,
    private readonly lifecycle: SessionLifecycleService,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: HistoryRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'history.list':
        return this.responder.reply(
          payload.clientReqId,
          this.history.list(payload.agentKind, payload.opts).pipe(
            Effect.flatMap((result) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'history.listed',
                    replyTo: payload.clientReqId,
                    result,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'history.read':
        return this.responder.reply(
          payload.clientReqId,
          this.history.read(payload.agentKind, payload.opts).pipe(
            Effect.flatMap((result) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'history.read.result',
                    replyTo: payload.clientReqId,
                    result,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'history.resume':
        return this.responder.reply(
          payload.clientReqId,
          this.lifecycle.resumeHistory(
            payload.clientReqId,
            payload.agentKind,
            payload.historyId,
            payload.startOpts,
          ),
        );
      default:
        return Effect.void;
    }
  }
}
