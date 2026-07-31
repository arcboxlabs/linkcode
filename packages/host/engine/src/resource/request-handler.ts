import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { WireResponder } from '../wire/responder';
import type { ResourceService } from './service';

type ResourceRequest = Extract<
  WirePayload,
  { kind: 'resource.list' | 'resource.source.upload' | 'resource.remove' | 'resource.host' }
>;
export class ResourceRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly service: ResourceService,
    private readonly responder: WireResponder,
  ) {}
  handle(payload: ResourceRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'resource.list':
        return this.responder.reply(
          payload.clientReqId,
          this.service.list(payload.sessionId).pipe(
            Effect.tap((resources) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'resource.listed',
                    replyTo: payload.clientReqId,
                    resources,
                  }),
                ),
              ),
            ),
            Effect.asVoid,
          ),
        );
      case 'resource.source.upload':
        return this.responder.reply(
          payload.clientReqId,
          this.service.upload(payload.sessionId, payload.name, payload.mimeType, payload.data).pipe(
            Effect.tap((resource) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'resource.uploaded',
                    replyTo: payload.clientReqId,
                    resource,
                  }),
                ),
              ),
            ),
            Effect.asVoid,
          ),
        );
      case 'resource.remove':
        return this.responder.reply(
          payload.clientReqId,
          this.service
            .remove(payload.resourceId)
            .pipe(
              Effect.tap(() => Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      case 'resource.host':
        return this.responder.reply(
          payload.clientReqId,
          this.service.host(payload.resourceId).pipe(
            Effect.tap((hosted) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'resource.hosted',
                    replyTo: payload.clientReqId,
                    hosted,
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
