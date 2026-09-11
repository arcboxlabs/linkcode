import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { SessionLifecycleService } from '../session/lifecycle-service';
import type { WireResponder } from '../wire/responder';
import type { ConversationProjectionService } from './projection-service';

type ConversationRequest = Extract<
  WirePayload,
  { kind: 'turn.submit' | 'conversation.graph.get' | 'conversation.read' }
>;

/** Wire surface for the turn tree: `turn.submit` runs the submit saga; `conversation.graph.get`
 * and `conversation.read` serve the host-composed projection. */
export class ConversationRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly lifecycle: SessionLifecycleService,
    private readonly projection: ConversationProjectionService,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: ConversationRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'conversation.graph.get':
        return this.responder.reply(
          payload.clientReqId,
          this.projection.graph(payload.sessionId).pipe(
            Effect.flatMap((result) =>
              Effect.sync(() => {
                this.transport.send(
                  createWireMessage({
                    kind: 'conversation.graph.result',
                    replyTo: payload.clientReqId,
                    ...result,
                  }),
                );
              }),
            ),
          ),
        );
      case 'conversation.read':
        return this.responder.reply(
          payload.clientReqId,
          this.projection
            .read({
              sessionId: payload.sessionId,
              leafTurnId: payload.leafTurnId,
              cursor: payload.cursor,
              limit: payload.limit,
            })
            .pipe(
              Effect.flatMap((result) =>
                Effect.sync(() => {
                  this.transport.send(
                    createWireMessage({
                      kind: 'conversation.read.result',
                      replyTo: payload.clientReqId,
                      ...result,
                    }),
                  );
                }),
              ),
            ),
        );
      case 'turn.submit':
        return this.responder.reply(
          payload.clientReqId,
          this.lifecycle.submitTurn(payload).pipe(
            Effect.flatMap((operation) =>
              Effect.sync(() => {
                // A stored failure replays verbatim: its code/message ARE the terminal result.
                this.transport.send(
                  createWireMessage(
                    operation.state === 'succeeded'
                      ? {
                          kind: 'turn.submitted',
                          replyTo: payload.clientReqId,
                          turnId: operation.turnId,
                        }
                      : {
                          kind: 'request.failed',
                          replyTo: payload.clientReqId,
                          code: operation.error.code,
                          message: operation.error.message,
                          ...(operation.error.reportedInConversation && {
                            reportedInConversation: true,
                          }),
                        },
                  ),
                );
              }),
            ),
          ),
        );
      default:
        return Effect.void;
    }
  }
}
