import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { WireResponder } from '../wire/responder';
import type { WorkspaceRegistry } from './workspace-registry';

type WorkspaceRequest = Extract<
  WirePayload,
  {
    kind: 'workspace.list' | 'workspace.register' | 'workspace.update' | 'workspace.archive';
  }
>;

/** Translates inbound workspace requests into registry operations. */
export class WorkspaceRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly workspaces: WorkspaceRegistry,
    private readonly responder: WireResponder,
  ) {}

  async handle(payload: WorkspaceRequest): Promise<void> {
    switch (payload.kind) {
      case 'workspace.list':
        this.transport.send(
          createWireMessage({
            kind: 'workspace.listed',
            replyTo: payload.clientReqId,
            workspaces: this.workspaces.list(),
          }),
        );
        break;
      case 'workspace.register':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const record = await this.workspaces.register({
            cwd: payload.cwd,
            name: payload.name,
            kind: payload.workspaceKind,
          });
          this.transport.send(
            createWireMessage({
              kind: 'workspace.registered',
              replyTo: payload.clientReqId,
              record,
            }),
          );
        });
        break;
      case 'workspace.update':
        await this.responder.tryReply(payload.clientReqId, () => {
          this.workspaces.update(payload.workspaceId, payload.name);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'workspace.archive':
        await this.responder.tryReply(payload.clientReqId, () => {
          this.workspaces.archive(payload.workspaceId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      default:
        break;
    }
  }
}
