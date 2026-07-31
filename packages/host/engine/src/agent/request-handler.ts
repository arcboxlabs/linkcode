import type { AdapterFactory } from '@linkcode/agent-adapter';
import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { OperationError, RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { AgentLoginService } from './login-service';
import type { ModelProbe } from './model-probe';
import { probeEndpointModels } from './model-probe';
import type { ProviderConfigStore } from './provider-config';
import { applyProviderDefaults } from './provider-config';
import type { AgentRuntimeService } from './runtime-service';

type AgentRequest = Extract<
  WirePayload,
  {
    kind:
      | 'agent-runtime.list'
      | 'agent.catalog'
      | 'config.get'
      | 'config.set'
      | 'config.account.create-and-bind'
      | 'config.probe-models'
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
    private readonly probeModels: ModelProbe = probeEndpointModels,
  ) {}

  handle(payload: AgentRequest): Effect.Effect<void> {
    switch (payload.kind) {
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
                }),
              ),
            catch: (cause) =>
              providerFailure('config.get', 'Failed to read provider config', cause),
          }),
        );
      case 'config.set': {
        const providers = payload.providers;
        const accounts = payload.accounts;
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
          ).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      }
      case 'config.account.create-and-bind':
        return this.responder.reply(
          payload.clientReqId,
          updateProviderConfig('config.account.create-and-bind', () =>
            this.providers.createAndBindAccount(payload.agent, payload.account),
          ).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'config.probe-models':
        return this.responder.reply(
          payload.clientReqId,
          Effect.tryPromise({
            try: async () => {
              const models = await this.probeModels(payload.endpoint, payload.secret);
              this.transport.send(
                createWireMessage({
                  kind: 'config.probe-models.result',
                  replyTo: payload.clientReqId,
                  models,
                }),
              );
            },
            // The vendor's own reason (bad key, unreachable host) is the whole value of the probe,
            // so it rides publicMessage — the only field that reaches the client.
            catch: (cause) =>
              new OperationError({
                subsystem: 'store',
                operation: 'config.probe-models',
                publicMessage: `Model detection failed: ${extractErrorMessage(cause, false) ?? 'unknown error'}`,
                cause,
              }),
          }),
        );
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
