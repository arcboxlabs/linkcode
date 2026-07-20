import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { toOperationFailure } from '../failure';
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

  handle(payload: WorkspaceRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'workspace.list':
        return Effect.sync(() =>
          this.transport.send(
            createWireMessage({
              kind: 'workspace.listed',
              replyTo: payload.clientReqId,
              workspaces: this.workspaces.list(),
            }),
          ),
        );
      case 'workspace.register':
        return this.responder.reply(
          payload.clientReqId,
          workspaceOperation('workspace.register', 'Failed to register workspace', () =>
            this.workspaces.register({
              cwd: payload.cwd,
              name: payload.name,
              kind: payload.workspaceKind,
            }),
          ).pipe(
            Effect.flatMap((record) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'workspace.registered',
                    replyTo: payload.clientReqId,
                    record,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'workspace.update':
        return this.responder.reply(
          payload.clientReqId,
          workspaceOperation('workspace.update', 'Failed to update workspace', () =>
            this.workspaces.update(payload.workspaceId, payload.name),
          ).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'workspace.archive':
        return this.responder.reply(
          payload.clientReqId,
          workspaceOperation('workspace.archive', 'Failed to archive workspace', () =>
            this.workspaces.archive(payload.workspaceId),
          ).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      default:
        return Effect.void;
    }
  }
}

function workspaceOperation<A>(
  operation: string,
  publicMessage: string,
  run: () => Promise<A>,
): Effect.Effect<A, ReturnType<typeof toOperationFailure>> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem: 'store', operation, publicMessage }),
  });
}
