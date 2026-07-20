import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { RequestError } from '../failure';
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

  handle(payload: FileRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'file.read':
        return this.responder.reply(
          payload.clientReqId,
          readWorkspaceFile(payload.cwd, payload.path).pipe(
            Effect.flatMap((file) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'file.read.result',
                    replyTo: payload.clientReqId,
                    file,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'file.list':
        return this.responder.reply(
          payload.clientReqId,
          this.registeredWorkspace(payload.cwd).pipe(
            Effect.flatMap((workspace) => this.files.list(workspace.cwd)),
            Effect.flatMap((files) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'file.list.result',
                    replyTo: payload.clientReqId,
                    files,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'file.suggest':
        return this.responder.reply(
          payload.clientReqId,
          this.registeredWorkspace(payload.cwd).pipe(
            Effect.flatMap((workspace) =>
              this.files.suggest(workspace.cwd, payload.query, payload.limit),
            ),
            Effect.flatMap((suggestions) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'file.suggest.result',
                    replyTo: payload.clientReqId,
                    suggestions,
                  }),
                ),
              ),
            ),
          ),
        );
      default:
        return Effect.void;
    }
  }

  private registeredWorkspace(cwd: string): Effect.Effect<{ cwd: string }, RequestError> {
    // Opened-roots scoping, not a hard boundary: callers may only enumerate roots known from a
    // session or explicit registration, and the read runs under the record's canonical cwd.
    const workspace = this.workspaces.findByCwd(cwd);
    return workspace
      ? Effect.succeed(workspace)
      : Effect.fail(new RequestError({ code: 'not_found', message: `Unknown workspace: ${cwd}` }));
  }
}
