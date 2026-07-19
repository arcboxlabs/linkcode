import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { WireResponder } from '../wire/responder';
import type { ArtifactHostService } from './artifact-host-service';

type ArtifactRequest = Extract<WirePayload, { kind: 'artifact.host' | 'artifact.revoke' }>;

/** Translates inbound artifact requests into preview-hosting operations. */
export class ArtifactRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly artifacts: ArtifactHostService,
    private readonly responder: WireResponder,
  ) {}

  async handle(payload: ArtifactRequest): Promise<void> {
    switch (payload.kind) {
      case 'artifact.host':
        await this.responder.tryReply(payload.clientReqId, () => {
          const artifact = this.artifacts.host(payload.content, payload.mimeType);
          this.transport.send(
            createWireMessage({
              kind: 'artifact.hosted',
              replyTo: payload.clientReqId,
              artifact,
            }),
          );
        });
        break;
      case 'artifact.revoke':
        this.artifacts.revoke(payload.hash);
        this.responder.sendSuccess(payload.clientReqId);
        break;
      default:
        break;
    }
  }
}
