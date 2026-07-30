import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { WireResponder } from '../wire/responder';
import type { PluginService } from './service';

type PluginRequest = Extract<
  WirePayload,
  { kind: 'plugin.list.get' | 'plugin.set-enabled' | 'skill.set-enabled' }
>;

/** Serves plugin discovery and plugin-level enablement over the wire. */
export class PluginRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly plugins: PluginService,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: PluginRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'plugin.list.get':
        return this.responder.reply(
          payload.clientReqId,
          this.plugins.list({ cwd: payload.cwd }).pipe(
            Effect.flatMap((result) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'plugin.list.result',
                    replyTo: payload.clientReqId,
                    plugins: result.plugins,
                    standaloneSkills: result.standaloneSkills,
                    providerStatus: result.providerStatus,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'plugin.set-enabled':
        return this.responder.reply(
          payload.clientReqId,
          this.plugins
            .setPluginEnabled(payload.provider, payload.id, payload.enabled, {
              scope: payload.scope,
              cwd: payload.cwd,
            })
            .pipe(
              Effect.flatMap((plugin) =>
                Effect.sync(() =>
                  this.transport.send(
                    createWireMessage({
                      kind: 'plugin.updated',
                      replyTo: payload.clientReqId,
                      plugin,
                    }),
                  ),
                ),
              ),
            ),
        );
      case 'skill.set-enabled':
        return this.responder.reply(
          payload.clientReqId,
          this.plugins
            .setSkillEnabled(
              payload.provider,
              { id: payload.skillId, path: payload.path, scope: payload.scope ?? 'user' },
              payload.enabled,
              { cwd: payload.cwd },
            )
            .pipe(
              Effect.flatMap((skill) =>
                Effect.sync(() =>
                  this.transport.send(
                    createWireMessage({
                      kind: 'skill.updated',
                      replyTo: payload.clientReqId,
                      skill,
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
}
