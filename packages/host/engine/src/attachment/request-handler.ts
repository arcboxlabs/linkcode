import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { WireResponder } from '../wire/responder';
import type { AttachmentUploadService } from './upload-service';

type AttachmentRequest = Extract<
  WirePayload,
  {
    kind:
      | 'attachment.upload.begin'
      | 'attachment.upload.chunk'
      | 'attachment.upload.commit'
      | 'attachment.upload.abort'
      | 'attachment.read';
  }
>;

export class AttachmentRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly uploads: AttachmentUploadService,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: AttachmentRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'attachment.upload.begin':
        return this.responder.reply(
          payload.clientReqId,
          this.uploads
            .begin({
              operationId: payload.operationId,
              declaredSha256: payload.declaredSha256,
              declaredSize: payload.declaredSize,
              name: payload.name,
              mimeType: payload.mimeType,
              attachmentKind: payload.attachmentKind,
            })
            .pipe(
              Effect.tap((result) =>
                Effect.sync(() =>
                  this.transport.send(
                    createWireMessage({
                      kind: 'attachment.upload.begun',
                      replyTo: payload.clientReqId,
                      ...result,
                    }),
                  ),
                ),
              ),
              Effect.asVoid,
            ),
        );
      case 'attachment.upload.chunk':
        return this.responder.reply(
          payload.clientReqId,
          this.uploads.chunk(payload.uploadId, payload.offset, payload.data).pipe(
            Effect.tap((ack) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'attachment.upload.chunk.acked',
                    replyTo: payload.clientReqId,
                    ...ack,
                  }),
                ),
              ),
            ),
            Effect.asVoid,
          ),
        );
      case 'attachment.upload.commit':
        return this.responder.reply(
          payload.clientReqId,
          this.uploads.commit(payload.uploadId).pipe(
            Effect.tap((result) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'attachment.upload.committed',
                    replyTo: payload.clientReqId,
                    ...result,
                  }),
                ),
              ),
            ),
            Effect.asVoid,
          ),
        );
      case 'attachment.upload.abort':
        return this.responder.reply(
          payload.clientReqId,
          this.uploads
            .abort(payload.uploadId)
            .pipe(
              Effect.tap(() => Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      case 'attachment.read':
        return this.responder.reply(
          payload.clientReqId,
          this.uploads
            .read(payload.sessionId, payload.attachmentId, payload.offset, payload.length)
            .pipe(
              Effect.tap((result) =>
                Effect.sync(() =>
                  this.transport.send(
                    createWireMessage({
                      kind: 'attachment.read.result',
                      replyTo: payload.clientReqId,
                      ...result,
                    }),
                  ),
                ),
              ),
              Effect.asVoid,
            ),
        );
      default:
        return Effect.void;
    }
  }
}
