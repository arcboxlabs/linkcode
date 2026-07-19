import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
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

  async handle(payload: HistoryRequest): Promise<void> {
    switch (payload.kind) {
      case 'history.list':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const result = await this.history.list(payload.agentKind, payload.opts);
          this.transport.send(
            createWireMessage({ kind: 'history.listed', replyTo: payload.clientReqId, result }),
          );
        });
        break;
      case 'history.read':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const result = await this.history.read(payload.agentKind, payload.opts);
          this.transport.send(
            createWireMessage({
              kind: 'history.read.result',
              replyTo: payload.clientReqId,
              result,
            }),
          );
        });
        break;
      case 'history.resume':
        await this.responder.tryReply(payload.clientReqId, () =>
          this.lifecycle.resumeHistory(
            payload.clientReqId,
            payload.agentKind,
            payload.historyId,
            payload.startOpts,
          ),
        );
        break;
      default:
        break;
    }
  }
}
