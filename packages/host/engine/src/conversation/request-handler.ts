import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { RequestError } from '../failure';
import type { SessionLifecycleService } from '../session/lifecycle-service';
import type { WireResponder } from '../wire/responder';

type ConversationRequest = Extract<
  WirePayload,
  { kind: 'turn.submit' | 'conversation.graph.get' | 'conversation.read' }
>;

/** Wire surface for the turn tree. `turn.submit` runs the submit saga; the read/projection kinds
 * keep failing loudly — never silently ignored — until the projection lands. */
export class ConversationRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly lifecycle: SessionLifecycleService,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: ConversationRequest): Effect.Effect<void> {
    if (payload.kind !== 'turn.submit') {
      return this.responder.reply(
        payload.clientReqId,
        Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: `${payload.kind} is not implemented yet`,
          }),
        ),
      );
    }
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
  }
}
