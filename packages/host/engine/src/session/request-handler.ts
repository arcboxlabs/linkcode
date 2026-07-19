import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
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

  async handle(payload: SessionRequest): Promise<void> {
    switch (payload.kind) {
      case 'session.start':
        await this.responder.tryReply(payload.clientReqId, () =>
          this.lifecycle.start(payload.clientReqId, payload.opts),
        );
        break;
      case 'agent.input':
        await this.responder.tryReply(payload.clientReqId, async () => {
          await this.sessions.sendInput(payload.sessionId, payload.input);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'session.stop':
        await this.responder.tryReply(payload.clientReqId, async () => {
          await this.sessions.stop(payload.sessionId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'session.delete':
        await this.responder.tryReply(payload.clientReqId, async () => {
          // Idempotent, unlike session.stop: provider-local history stays untouched, so the session
          // can still be imported after another client deleted the LinkCode record.
          await this.sessions.delete(payload.sessionId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'session.list':
        this.transport.send(
          createWireMessage({
            kind: 'session.listed',
            replyTo: payload.clientReqId,
            sessions: this.sessions.list(),
          }),
        );
        break;
      case 'session.resume':
        await this.responder.tryReply(payload.clientReqId, () =>
          this.lifecycle.resumeSession(payload.clientReqId, payload.sessionId),
        );
        break;
      case 'session.import':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const record = await this.lifecycle.importSession(payload.agentKind, payload.historyId);
          this.transport.send(
            createWireMessage({ kind: 'session.imported', replyTo: payload.clientReqId, record }),
          );
        });
        break;
      case 'session.attach':
        // The Hub already attached this connection. Replay state that history cannot recover;
        // clients fold it idempotently and deduplicate interactive requests by requestId.
        this.sessions.replay(payload.sessionId);
        break;
      case 'session.detach':
        // The Hub already removed this connection's session subscription.
        break;
      default:
        break;
    }
  }
}
