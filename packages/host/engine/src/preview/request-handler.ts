import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { EngineFailure } from '../failure';
import { toOperationFailure } from '../failure';
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

  handle(payload: ArtifactRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'artifact.host':
        return this.responder.reply(
          payload.clientReqId,
          artifactOperation('artifact.host', 'Failed to host artifact', () =>
            this.artifacts.host(payload.content, payload.mimeType),
          ).pipe(
            Effect.flatMap((artifact) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'artifact.hosted',
                    replyTo: payload.clientReqId,
                    artifact,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'artifact.revoke':
        return this.responder.reply(
          payload.clientReqId,
          artifactOperation('artifact.revoke', 'Failed to revoke artifact', () =>
            this.artifacts.revoke(payload.hash),
          ).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      default:
        return Effect.void;
    }
  }
}

function artifactOperation<A>(
  operation: string,
  publicMessage: string,
  run: () => A,
): Effect.Effect<A, EngineFailure> {
  return Effect.try({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem: 'preview', operation, publicMessage }),
  });
}
