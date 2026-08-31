import type { WirePayload } from '@linkcode/schema';
import { Effect } from 'effect';
import { RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { ConversationStore } from './conversation-store';

type ConversationRequest = Extract<
  WirePayload,
  { kind: 'turn.submit' | 'conversation.graph.get' | 'conversation.read' }
>;

/** Declared wire surface for the turn tree. A known kind must fail loudly, never be silently
 * ignored — every request is refused with a typed error until the submit saga and the projection
 * land on top of {@link ConversationStore}. */
export class ConversationRequestHandler {
  constructor(
    /** Held for the submit saga and projection reads that build on this handler. */
    readonly store: ConversationStore,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: ConversationRequest): Effect.Effect<void> {
    return this.responder.reply(
      payload.clientReqId,
      Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: `${payload.kind} is not implemented yet (CODE-629/CODE-631)`,
        }),
      ),
    );
  }
}
