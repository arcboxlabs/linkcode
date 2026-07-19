import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { RequestError, toOperationFailure } from '../failure';
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
          fileOperation('file.list', 'Failed to list workspace files', () =>
            this.files.list(this.registeredWorkspace(payload.cwd).cwd),
          ).pipe(
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
          fileOperation('file.suggest', 'Failed to suggest workspace files', () => {
            const workspace = this.registeredWorkspace(payload.cwd);
            return this.files.suggest(workspace.cwd, payload.query, payload.limit);
          }).pipe(
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

  private registeredWorkspace(cwd: string) {
    // Opened-roots scoping, not a hard boundary: callers may only enumerate roots known from a
    // session or explicit registration, and the read runs under the record's canonical cwd.
    const workspace = this.workspaces.findByCwd(cwd);
    // eslint-disable-next-line sukka/prefer-nullthrow -- The wire boundary requires a typed, safely presentable error instead of nullthrow's TypeError.
    if (!workspace) {
      throw new RequestError({ code: 'not_found', message: `Unknown workspace: ${cwd}` });
    }
    return workspace;
  }
}

function fileOperation<A>(operation: string, publicMessage: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      toOperationFailure(cause, { subsystem: 'filesystem', operation, publicMessage }),
  });
}
