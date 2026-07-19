import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { WireResponder } from '../wire/responder';
import type { SessionLifecycleService } from './lifecycle-service';
import type { SessionOrchestrator } from './orchestrator';

type SessionRequest = Extract<
  WirePayload,
  {
    kind:
      | 'session.start'
      | 'agent.input'
      | 'session.stop'
      | 'session.delete'
      | 'session.list'
      | 'session.resume'
      | 'session.import'
      | 'session.attach'
      | 'session.detach';
  }
>;

/** Translates session control requests into lifecycle and live-session operations. */
export class SessionRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly lifecycle: SessionLifecycleService,
    private readonly sessions: SessionOrchestrator,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: SessionRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'session.start':
        return this.responder.reply(
          payload.clientReqId,
          this.lifecycle.start(payload.clientReqId, payload.opts),
        );
      case 'agent.input':
        return this.responder.reply(
          payload.clientReqId,
          this.sessions
            .sendInput(payload.sessionId, payload.input)
            .pipe(
              Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      case 'session.stop':
        return this.responder.reply(
          payload.clientReqId,
          this.sessions
            .stop(payload.sessionId)
            .pipe(
              Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      case 'session.delete':
        // Idempotent, unlike session.stop: provider-local history stays untouched, so the session
        // can still be imported after another client deleted the LinkCode record.
        return this.responder.reply(
          payload.clientReqId,
          this.sessions
            .delete(payload.sessionId)
            .pipe(
              Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      case 'session.list':
        return Effect.sync(() =>
          this.transport.send(
            createWireMessage({
              kind: 'session.listed',
              replyTo: payload.clientReqId,
              sessions: this.sessions.list(),
            }),
          ),
        );
      case 'session.resume':
        return this.responder.reply(
          payload.clientReqId,
          this.lifecycle.resumeSession(payload.clientReqId, payload.sessionId),
        );
      case 'session.import':
        return this.responder.reply(
          payload.clientReqId,
          this.lifecycle.importSession(payload.agentKind, payload.historyId).pipe(
            Effect.flatMap((record) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'session.imported',
                    replyTo: payload.clientReqId,
                    record,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'session.attach':
        // The Hub already attached this connection. Replay state that history cannot recover;
        // clients fold it idempotently and deduplicate interactive requests by requestId.
        return Effect.sync(() => this.sessions.replay(payload.sessionId));
      case 'session.detach':
        // The Hub already removed this connection's session subscription.
        return Effect.void;
      default:
        return Effect.void;
    }
  }
}
