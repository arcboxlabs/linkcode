import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import type { WireResponder } from '../wire/responder';
import { readWorkspaceFile } from './file-service';
import type { FileSuggestService } from './file-suggest-service';
import type { WorkspaceRegistry } from './workspace-registry';

type FileRequest = Extract<WirePayload, { kind: 'file.read' | 'file.list' | 'file.suggest' }>;

/** Translates inbound file reads and registered-workspace enumeration requests. */
export class FileRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly files: FileSuggestService,
    private readonly workspaces: WorkspaceRegistry,
    private readonly responder: WireResponder,
  ) {}

  async handle(payload: FileRequest): Promise<void> {
    switch (payload.kind) {
      case 'file.read':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const file = await readWorkspaceFile(payload.cwd, payload.path);
          this.transport.send(
            createWireMessage({
              kind: 'file.read.result',
              replyTo: payload.clientReqId,
              file,
            }),
          );
        });
        break;
      case 'file.list':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const workspace = this.registeredWorkspace(payload.cwd);
          const files = await this.files.list(workspace.cwd);
          this.transport.send(
            createWireMessage({
              kind: 'file.list.result',
              replyTo: payload.clientReqId,
              files,
            }),
          );
        });
        break;
      case 'file.suggest':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const workspace = this.registeredWorkspace(payload.cwd);
          const suggestions = await this.files.suggest(workspace.cwd, payload.query, payload.limit);
          this.transport.send(
            createWireMessage({
              kind: 'file.suggest.result',
              replyTo: payload.clientReqId,
              suggestions,
            }),
          );
        });
        break;
      default:
        break;
    }
  }

  private registeredWorkspace(cwd: string) {
    // Opened-roots scoping, not a hard boundary: callers may only enumerate roots known from a
    // session or explicit registration, and the read runs under the record's canonical cwd.
    return nullthrow(this.workspaces.findByCwd(cwd), `Unknown workspace: ${cwd}`);
  }
}
