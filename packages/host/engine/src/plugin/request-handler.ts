import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { EngineFailure } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { PluginMutationResult, PluginService } from './service';

type PluginRequest = Extract<
  WirePayload,
  {
    kind:
      | 'plugin.list.get'
      | 'plugin.set-enabled'
      | 'plugin.install'
      | 'plugin.uninstall'
      | 'skill.set-enabled';
  }
>;

/** Serves plugin discovery, enablement, and installation over the wire. */
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
        return this.replyUpdated(
          payload.clientReqId,
          this.plugins.setPluginEnabled(payload.provider, payload.id, payload.enabled, {
            scope: payload.scope,
            cwd: payload.cwd,
          }),
        );
      case 'plugin.install':
        return this.replyUpdated(
          payload.clientReqId,
          this.plugins.installPlugin(payload.provider, payload.id, { cwd: payload.cwd }),
        );
      case 'plugin.uninstall':
        return this.replyUpdated(
          payload.clientReqId,
          this.plugins.uninstallPlugin(payload.provider, payload.id, { cwd: payload.cwd }),
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

  /** Every plugin mutation answers with the re-listed plugin, so clients patch one cache entry
   * instead of re-running discovery. */
  private replyUpdated(
    clientReqId: string,
    mutation: Effect.Effect<PluginMutationResult, EngineFailure>,
  ): Effect.Effect<void> {
    return this.responder.reply(
      clientReqId,
      mutation.pipe(
        Effect.flatMap(({ plugin, pendingAuthApps }) =>
          Effect.sync(() =>
            this.transport.send(
              createWireMessage({
                kind: 'plugin.updated',
                replyTo: clientReqId,
                plugin,
                ...(pendingAuthApps && pendingAuthApps.length > 0 && { pendingAuthApps }),
              }),
            ),
          ),
        ),
      ),
    );
  }
}
