import type { AgentKind, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { PendingRegistry } from './pending-registry';
import { sendCorrelated } from './pending-registry';

/** Terminal outcome of an interactive login: `ok`, or a failure `error` to show. */
export interface AgentLoginSettled {
  ok: boolean;
  error?: string;
}

export interface AgentLoginHandlers {
  /** The browser authorize URL to open — emitted at most once. */
  onUrl: (url: string) => void;
  /** The final outcome; the subscription is torn down after it fires. */
  onSettled: (result: AgentLoginSettled) => void;
}

/**
 * Client side of the interactive `agent-login.*` flow. `start` is request/reply (→ loginId); the
 * host then pushes the browser `url` and the terminal `settled` outcome, consumed by a single
 * subscriber (the login card) per loginId. `submitCode` / `cancel` are fire-and-forget. A `url` or
 * `settled` that arrives before the subscriber attaches is buffered and replayed, so the
 * start→subscribe gap never drops the browser URL.
 */
export class AgentLoginChannel {
  private readonly handlers = new Map<string, AgentLoginHandlers>();
  private readonly bufferedUrl = new Map<string, string>();
  private readonly bufferedSettled = new Map<string, AgentLoginSettled>();

  constructor(
    private readonly transport: Transport,
    private readonly pending: PendingRegistry,
  ) {}

  /** Route an `agent-login.*` reply/event. Returns false if `p` wasn't a login message. */
  handleMessage(p: WirePayload): boolean {
    switch (p.kind) {
      case 'agent-login.started':
        this.pending.resolve('agentLoginStart', p.replyTo, p.loginId);
        return true;
      case 'agent-login.url': {
        const handlers = this.handlers.get(p.loginId);
        if (handlers) handlers.onUrl(p.url);
        else this.bufferedUrl.set(p.loginId, p.url);
        return true;
      }
      case 'agent-login.settled': {
        const result: AgentLoginSettled = {
          ok: p.ok,
          ...(p.error !== undefined && { error: p.error }),
        };
        const handlers = this.handlers.get(p.loginId);
        if (handlers) {
          handlers.onSettled(result);
          this.dispose(p.loginId);
        } else {
          this.bufferedSettled.set(p.loginId, result);
        }
        return true;
      }
      default:
        return false;
    }
  }

  start(agent: AgentKind): Promise<string> {
    return sendCorrelated(this.transport, this.pending, 'agentLoginStart', (clientReqId) => ({
      kind: 'agent-login.start',
      clientReqId,
      agent,
    }));
  }

  submitCode(loginId: string, code: string): void {
    this.send({ kind: 'agent-login.submit-code', loginId, code });
  }

  cancel(loginId: string): void {
    this.send({ kind: 'agent-login.cancel', loginId });
  }

  subscribe(loginId: string, handlers: AgentLoginHandlers): Unsubscribe {
    this.handlers.set(loginId, handlers);
    const url = this.bufferedUrl.get(loginId);
    if (url !== undefined) {
      this.bufferedUrl.delete(loginId);
      handlers.onUrl(url);
    }
    const settled = this.bufferedSettled.get(loginId);
    if (settled) {
      this.bufferedSettled.delete(loginId);
      handlers.onSettled(settled);
      this.dispose(loginId);
    }
    return () => this.dispose(loginId);
  }

  disposeAll(): void {
    this.handlers.clear();
    this.bufferedUrl.clear();
    this.bufferedSettled.clear();
  }

  private dispose(loginId: string): void {
    this.handlers.delete(loginId);
    this.bufferedUrl.delete(loginId);
    this.bufferedSettled.delete(loginId);
  }

  private send(payload: WirePayload): void {
    void Promise.resolve(this.transport.send(createWireMessage(payload)));
  }
}
