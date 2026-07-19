import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { ManagedAssetService } from '../asset/service';
import { RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { AgentLoginService } from './login-service';
import type { ProviderConfigStore } from './provider-config';
import type { AgentRuntimeService } from './runtime-service';

type AgentRequest = Extract<
  WirePayload,
  {
    kind:
      | 'agent-runtime.list'
      | 'asset.list'
      | 'asset.ensure'
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
    private readonly assets: ManagedAssetService,
    private readonly providers: ProviderConfigStore,
    private readonly logins: AgentLoginService | undefined,
    private readonly responder: WireResponder,
  ) {}

  async handle(payload: AgentRequest): Promise<void> {
    switch (payload.kind) {
      case 'agent-runtime.list':
        // A pre-probe snapshot reads as every agent missing, so hold the reply until seeding lands.
        this.runtimes.serve((runtimes) => {
          this.transport.send(
            createWireMessage({
              kind: 'agent-runtime.listed',
              replyTo: payload.clientReqId,
              runtimes,
            }),
          );
        });
        break;
      case 'asset.list':
        this.assets.list(payload.clientReqId);
        break;
      case 'asset.ensure':
        // Installation deliberately outlives this handler invocation and replies when settled.
        this.assets.ensure(payload.clientReqId, payload.id);
        break;
      case 'config.get':
        this.transport.send(
          createWireMessage({
            kind: 'config.get.result',
            replyTo: payload.clientReqId,
            providers: this.providers.get(),
            accounts: this.providers.getAccounts(),
          }),
        );
        break;
      case 'config.set':
        await this.responder.tryReply(payload.clientReqId, async () => {
          if (payload.providers !== undefined) await this.providers.set(payload.providers);
          if (payload.accounts !== undefined) await this.providers.setAccounts(payload.accounts);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'agent-login.start': {
        const logins = this.logins;
        if (logins) {
          logins.start(payload.clientReqId, payload.agent);
        } else {
          this.responder.sendFailure(
            payload.clientReqId,
            new RequestError({
              code: 'unsupported',
              message: 'Login is not supported on this host',
            }),
          );
        }
        break;
      }
      case 'agent-login.submit-code':
        this.logins?.submitCode(payload.loginId, payload.code);
        break;
      case 'agent-login.cancel':
        this.logins?.cancel(payload.loginId);
        break;
      default:
        break;
    }
  }
}
