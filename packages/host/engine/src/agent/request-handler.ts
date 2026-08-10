import type { AdapterFactory } from '@linkcode/agent-adapter';
import { modelListSource } from '@linkcode/providers';
import type { AccountSecret, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { OperationError, RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { CustomMcpServerService } from './custom-mcp-service';
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
    private readonly customMcp: CustomMcpServerService,
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
              // A pre-session read: an account the agent cannot bind still names the model list
              // worth showing, so `unavailable` is deliberately not fatal here.
              const { options: startOptions } = applyProviderDefaults(
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
                  customMcpServers: this.customMcp.listPublic(),
                }),
              ),
            catch: (cause) =>
              providerFailure('config.get', 'Failed to read provider config', cause),
          }),
        );
      case 'config.set': {
        const providers = payload.providers;
        const accounts = payload.accounts;
        const customMcpServers = payload.customMcpServers;
        return this.responder.reply(
          payload.clientReqId,
          updateProviderConfig('config.set', () =>
            this.providers.update({
              ...(providers !== undefined && { providers }),
              ...(accounts !== undefined && { accounts }),
            }),
          ).pipe(
            Effect.andThen(
              customMcpServers === undefined
                ? Effect.void
                : this.customMcp.applyPatch(customMcpServers),
            ),
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      }
      case 'config.probe-models':
        return this.responder.reply(
          payload.clientReqId,
          Effect.tryPromise({
            try: async () => {
              const source = modelListSource(payload.service);
              if (!source) {
                throw new Error(`${payload.service} serves no model list`);
              }
              const models = await this.probeModels(
                source,
                this.probeSecret(payload.service, payload.credential),
              );
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

  /**
   * The secret to probe with. A saved account is named by id rather than shipping its secret back
   * out to the client and in again; an oauth login holds none, so it cannot be probed.
   *
   * The destination and the credential arrive as two independent client-chosen fields, so the
   * account must belong to the service being probed — otherwise a request could aim one vendor's
   * key at another vendor's endpoint. An account with no service is refused for the same reason:
   * only catalog services are probeable, so nothing it could legitimately match.
   */
  private probeSecret(
    service: string,
    credential: Extract<AgentRequest, { kind: 'config.probe-models' }>['credential'],
  ): AccountSecret {
    if (credential.type === 'inline') return credential.secret;
    const account = this.providers
      .getAccounts()
      .find((candidate) => candidate.id === credential.accountId);
    if (!account) throw new Error('Account not found');
    if (account.service !== service) {
      throw new Error('That account does not belong to the service being probed');
    }
    if (account.credential.type === 'oauth') {
      throw new Error('A subscription login holds no secret to read the model list with');
    }
    return account.credential;
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
