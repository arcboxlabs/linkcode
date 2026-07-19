import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { WireResponder } from '../wire/responder';
import type { GitService } from './git-service';

type GitRequest = Extract<
  WirePayload,
  { kind: 'git.status.get' | 'git.pr_status.get' | 'git.diff.get' }
>;

/** Translates inbound git requests into cached local and provider reads. */
export class GitRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly git: GitService,
    private readonly responder: WireResponder,
  ) {}

  async handle(payload: GitRequest): Promise<void> {
    switch (payload.kind) {
      case 'git.status.get':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const status = await this.git.getStatus(payload.cwd);
          this.transport.send(
            createWireMessage({
              kind: 'git.status.get.result',
              replyTo: payload.clientReqId,
              status,
            }),
          );
        });
        break;
      case 'git.pr_status.get':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const prStatus = await this.git.getPullRequestStatus(payload.cwd);
          this.transport.send(
            createWireMessage({
              kind: 'git.pr_status.get.result',
              replyTo: payload.clientReqId,
              prStatus,
            }),
          );
        });
        break;
      case 'git.diff.get':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const diff = await this.git.getDiff(payload.cwd, payload.mode);
          this.transport.send(
            createWireMessage({
              kind: 'git.diff.get.result',
              replyTo: payload.clientReqId,
              diff,
            }),
          );
        });
        break;
      default:
        break;
    }
  }
}
