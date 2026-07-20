import type { AdapterFactory } from '@linkcode/agent-adapter';
import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { OperationError, RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';
import { listEndpointModels } from './endpoint-models';
import type { AgentLoginService } from './login-service';
import type { ProviderConfigStore } from './provider-config';
import { withBoundAccountModels } from './provider-config';
import type { AgentRuntimeService } from './runtime-service';

type AgentRequest = Extract<
  WirePayload,
  {
    kind:
      | 'agent-runtime.list'
      | 'config.get'
      | 'config.set'
      | 'agent.catalog'
      | 'endpoint.list-models'
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
      case 'agent.catalog': {
        return this.responder.reply(
          payload.clientReqId,
          Effect.tryPromise({
            // A never-started factory instance, the history-read pattern: startCatalog must not
            // touch any start() state, so a throwaway adapter is safe and needs no cleanup.
            try: async () => {
              const machineScoped = await this.factory(payload.agentKind).startCatalog({
                cwd: payload.cwd,
              });
              // pi and opencode register account-defined providers (Account.customProvider) at
              // session start; their pre-session pickers get the bound account's models here.
              return payload.agentKind === 'pi' || payload.agentKind === 'opencode'
                ? withBoundAccountModels(
                    machineScoped,
                    this.providers.get()[payload.agentKind],
                    this.providers.getAccounts(),
                  )
                : machineScoped;
            },
            catch: (cause) =>
              new OperationError({
                subsystem: 'agent',
                operation: 'agent.catalog',
                publicMessage: 'Failed to read the agent catalog',
                cause,
              }),
          }).pipe(
            Effect.tap((catalog) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'agent.cataloged',
                    replyTo: payload.clientReqId,
                    catalog,
                  }),
                ),
              ),
            ),
            Effect.asVoid,
          ),
        );
      }
      case 'endpoint.list-models': {
        return this.responder.reply(
          payload.clientReqId,
          Effect.tryPromise({
            try: () =>
              listEndpointModels({
                baseUrl: payload.baseUrl,
                protocol: payload.protocol,
                secret: payload.secret,
                credentialType: payload.credentialType,
              }),
            catch: (cause) =>
              new OperationError({
                subsystem: 'agent',
                operation: 'endpoint.list-models',
                publicMessage: extractErrorMessage(cause) ?? 'Failed to list endpoint models',
                cause,
              }),
          }).pipe(
            Effect.tap((models) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'endpoint.models-listed',
                    replyTo: payload.clientReqId,
                    models,
                  }),
                ),
              ),
            ),
            Effect.asVoid,
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
