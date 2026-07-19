import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
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

  async handle(payload: ScriptRequest): Promise<void> {
    const scripts = this.scripts;
    if (!scripts) {
      this.responder.sendFailure(
        payload.clientReqId,
        new RequestError({
          code: 'unsupported',
          message: 'Scripts are not supported on this host',
        }),
      );
      return;
    }

    switch (payload.kind) {
      case 'script.list':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const list = await scripts.list(payload.cwd);
          this.transport.send(
            createWireMessage({
              kind: 'script.listed',
              replyTo: payload.clientReqId,
              scripts: list,
            }),
          );
        });
        break;
      case 'script.start':
        await this.responder.tryReply(payload.clientReqId, async () => {
          await scripts.start(payload.cwd, payload.scriptName);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'script.stop':
        await this.responder.tryReply(payload.clientReqId, () => {
          scripts.stop(payload.cwd, payload.scriptName);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      default:
        break;
    }
  }
}
