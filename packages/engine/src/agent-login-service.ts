import type { AgentLoginCallbacks, AgentLoginHandle } from '@linkcode/agent-adapter';
import { startClaudeLogin } from '@linkcode/agent-adapter';
import type { AgentKind, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';

/** Resolve the spawnable CLI for an agent's interactive login; `undefined` = cannot log in here. */
export type LoginBinaryResolver = (agent: AgentKind) => string | undefined;

/** Starts the CLI login and returns its handle — the {@link startClaudeLogin} seam, faked in tests. */
export type StartLogin = (binaryPath: string, callbacks: AgentLoginCallbacks) => AgentLoginHandle;

/**
 * AgentLoginService: drives an agent CLI's own OAuth login as a short-lived headless child and
 * bridges it to the `agent-login.*` wire. Only claude-code is implemented — its `auth login` uses a
 * remote OAuth callback page, so the browser URL streams down (`agent-login.url`) and the pasted
 * authorization code round-trips up (`agent-login.submit-code`). A clean login calls {@link onSuccess}
 * so the engine re-probes and pushes the refreshed runtime snapshot, clearing the "needs login" cue.
 */
export class AgentLoginService {
  private readonly logins = new Map<string, AgentLoginHandle>();
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    private readonly resolveBinary: LoginBinaryResolver,
    private readonly onSuccess: () => void,
    private readonly startLogin: StartLogin = startClaudeLogin,
  ) {}

  /** Begin a login for `agent`, reply `agent-login.started`, then stream `url` / `settled`. */
  start(clientReqId: string, agent: AgentKind): void {
    const loginId = this.nextLoginId();
    this.send({ kind: 'agent-login.started', replyTo: clientReqId, loginId });

    if (agent !== 'claude-code') {
      this.settle(loginId, false, `login is not supported for ${agent}`);
      return;
    }
    const binaryPath = this.resolveBinary(agent);
    if (!binaryPath) {
      this.settle(loginId, false, 'the claude-code CLI is not available to log in');
      return;
    }

    const handle = this.startLogin(binaryPath, {
      onUrl: (url) => this.send({ kind: 'agent-login.url', loginId, url }),
      onSettled: ({ ok, error }) => {
        this.logins.delete(loginId);
        this.settle(loginId, ok, error);
        if (ok) this.onSuccess();
      },
    });
    this.logins.set(loginId, handle);
  }

  submitCode(loginId: string, code: string): void {
    this.logins.get(loginId)?.submitCode(code);
  }

  cancel(loginId: string): void {
    this.logins.get(loginId)?.cancel();
  }

  /** Abort every in-flight login (engine shutdown). */
  closeAll(): void {
    for (const handle of this.logins.values()) handle.cancel();
    this.logins.clear();
  }

  private settle(loginId: string, ok: boolean, error?: string): void {
    this.send({ kind: 'agent-login.settled', loginId, ok, ...(error && { error }) });
  }

  private nextLoginId(): string {
    this.seq += 1;
    return `login-${Date.now().toString(36)}-${this.seq.toString(36)}`;
  }

  private send(payload: WirePayload): void {
    this.transport.send(createWireMessage(payload));
  }
}
