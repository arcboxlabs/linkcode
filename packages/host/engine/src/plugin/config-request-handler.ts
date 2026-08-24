import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { WireResponder } from '../wire/responder';
import type { PluginConfigService } from './config-service';

type PluginConfigRequest = Extract<
  WirePayload,
  { kind: 'plugin-config.list.get' | 'plugin-config.set' }
>;

/** Serves the LinkCode plugin settings wire plane: masked list and per-key patch writes. */
export class LinkCodePluginConfigRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly config: PluginConfigService,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: PluginConfigRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'plugin-config.list.get':
        return this.responder.reply(
          payload.clientReqId,
          Effect.sync(() => {
            const plugins = this.config.list().map((view) => ({
              id: view.id,
              version: view.version,
              settings: view.settings,
              values: view.values,
            }));
            this.transport.send(
              createWireMessage({
                kind: 'plugin-config.listed',
                replyTo: payload.clientReqId,
                plugins,
              }),
            );
          }),
        );
      case 'plugin-config.set':
        return this.responder.reply(
          payload.clientReqId,
          this.config
            .applyPatch(payload.pluginId, { set: payload.set, remove: payload.remove })
            .pipe(
              Effect.flatMap(() =>
                Effect.sync(() => {
                  const values = this.config.maskedValues(payload.pluginId);
                  this.transport.send(
                    createWireMessage({
                      kind: 'plugin-config.updated',
                      replyTo: payload.clientReqId,
                      pluginId: payload.pluginId,
                      values,
                    }),
                  );
                }),
              ),
            ),
        );
      default:
        return Effect.void;
    }
  }
}
