import type { AdapterFactory } from '@linkcode/agent-adapter';
import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import { MCP_PLUGIN_CATALOG } from '../plugin/catalog';
import type { WireResponder } from '../wire/responder';
import type { AgentLoginService } from './login-service';
import type { ProviderConfigStore } from './provider-config';
import { applyPluginConfigSet, applyProviderDefaults, publicPluginConfig } from './provider-config';
import type { AgentRuntimeService } from './runtime-service';

type AgentRequest = Extract<
  WirePayload,
  {
    kind:
      | 'agent-runtime.list'
      | 'agent.catalog'
      | 'plugin.catalog.get'
      | 'config.get'
      | 'config.set'
      | 'agent-login.start'
      | 'agent-login.submit-code'
      | 'agent-login.cancel';
  }
>;

/** Handles wire requests that manage the host's installed agents and provider configuration. */
export class AgentRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly runtimes: AgentRuntimeService,
    private readonly providers: ProviderConfigStore,
    private readonly logins: AgentLoginService | undefined,
    private readonly responder: WireResponder,
    private readonly factory: AdapterFactory,
  ) {}

  handle(payload: AgentRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'plugin.catalog.get':
        return this.responder.reply(
          payload.clientReqId,
          Effect.try({
            try: () =>
              this.transport.send(
                createWireMessage({
                  kind: 'plugin.catalog.result',
                  replyTo: payload.clientReqId,
                  catalog: MCP_PLUGIN_CATALOG,
                }),
              ),
            catch: (cause) =>
              providerFailure('plugin.catalog.get', 'Failed to load plugin catalog', cause),
          }),
        );
      case 'agent.catalog':
        return this.responder.reply(
          payload.clientReqId,
          Effect.tryPromise({
            try: async () => {
              const startOptions = applyProviderDefaults(
                { kind: payload.agentKind, cwd: payload.cwd ?? '.' },
                this.providers.get(),
                this.providers.getAccounts(),
              );
              const catalog = await this.factory(payload.agentKind).startCatalog({
                cwd: payload.cwd,
                model: startOptions.model,
                config: startOptions.config,
              });
              this.transport.send(
                createWireMessage({
                  kind: 'agent.cataloged',
                  replyTo: payload.clientReqId,
                  catalog,
                }),
              );
            },
            catch: (cause) =>
              new OperationError({
                subsystem: 'agent',
                operation: 'agent.catalog',
                publicMessage: 'Failed to load agent catalog',
                cause,
              }),
          }),
        );
      case 'agent-runtime.list': {
        // A pre-probe snapshot reads as every agent missing, so hold the reply until seeding lands.
        return this.runtimes.snapshot().pipe(
          Effect.tap((runtimes) =>
            Effect.sync(() =>
              this.transport.send(
                createWireMessage({
                  kind: 'agent-runtime.listed',
                  replyTo: payload.clientReqId,
                  runtimes,
                }),
              ),
            ),
          ),
          Effect.andThen(this.runtimes.revalidate()),
          Effect.asVoid,
        );
      }
      case 'config.get':
        return this.responder.reply(
          payload.clientReqId,
          Effect.try({
            try: () =>
              this.transport.send(
                createWireMessage({
                  kind: 'config.get.result',
                  replyTo: payload.clientReqId,
                  providers: this.providers.get(),
                  accounts: this.providers.getAccounts(),
                  plugins: publicPluginConfig(this.providers.getPlugins()),
                }),
              ),
            catch: (cause) =>
              providerFailure('config.get', 'Failed to read provider config', cause),
          }),
        );
      case 'config.set': {
        const providers = payload.providers;
        const accounts = payload.accounts;
        const plugins = payload.plugins;
        return this.responder.reply(
          payload.clientReqId,
          Effect.andThen(
            providers === undefined
              ? Effect.void
              : updateProviderConfig('config.set-providers', () => this.providers.set(providers)),
            accounts === undefined
              ? Effect.void
              : updateProviderConfig('config.set-accounts', () =>
                  this.providers.setAccounts(accounts),
                ),
          )
            .pipe(
              Effect.andThen(
                plugins === undefined
                  ? Effect.void
                  : updateProviderConfig('config.set-plugins', () =>
                      this.providers.setPlugins(
                        applyPluginConfigSet(this.providers.getPlugins(), plugins),
                      ),
                    ),
              ),
            )
            .pipe(
              Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
            ),
        );
      }
      case 'agent-login.start': {
        const logins = this.logins;
        if (logins) {
          return this.responder.reply(
            payload.clientReqId,
            Effect.try({
              try: () => logins.start(payload.clientReqId, payload.agent),
              catch: (cause) =>
                new OperationError({
                  subsystem: 'agent',
                  operation: 'agent-login.start',
                  publicMessage: 'Failed to start agent login',
                  cause,
                }),
            }),
          );
        }
        return Effect.sync(() =>
          this.responder.sendFailure(
            payload.clientReqId,
            new RequestError({
              code: 'unsupported',
              message: 'Login is not supported on this host',
            }),
          ),
        );
      }
      case 'agent-login.submit-code':
        return Effect.sync(() => this.logins?.submitCode(payload.loginId, payload.code));
      case 'agent-login.cancel':
        return Effect.sync(() => this.logins?.cancel(payload.loginId));
      default:
        return Effect.void;
    }
  }
}

function updateProviderConfig(
  operation: string,
  update: () => void | Promise<void>,
): Effect.Effect<void, OperationError> {
  return Effect.tryPromise({
    try: () => Promise.resolve().then(update),
    catch: (cause) => providerFailure(operation, 'Failed to update provider config', cause),
  });
}

function providerFailure(operation: string, publicMessage: string, cause: unknown): OperationError {
  return new OperationError({ subsystem: 'store', operation, publicMessage, cause });
}
