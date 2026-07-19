import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { isRecord, stringField } from '../../history-util';
import type { AgentLoginCallbacks, AgentLoginHandle } from '../../login';
import type { CodexAppServerOptions } from './app-server';
import { CodexAppServer } from './app-server';

/** The slice of {@link CodexAppServer} the login flow drives — the test seam's fake shape. */
export type CodexLoginServer = Pick<CodexAppServer, 'request' | 'close'>;
export type StartLoginServer = (opts: CodexAppServerOptions) => Promise<CodexLoginServer>;

/**
 * Drive codex's ChatGPT OAuth through a short-lived `codex app-server`: `account/login/start`
 * returns `{loginId, authUrl}`, the app-server runs its own localhost callback, and
 * `account/login/completed {loginId, success, error?}` settles the flow (verified live on
 * codex-cli 0.144.1). No code is handed back — `submitCode` is a no-op. The child inherits the
 * daemon environment and writes `$CODEX_HOME/auth.json` where the probe and future session spawns
 * read it (a RUNNING app-server caches credentials until respawn — the adapter's auth retirement).
 */
export function startCodexLogin(
  binaryPath: string,
  callbacks: AgentLoginCallbacks,
  startServer: StartLoginServer = CodexAppServer.start,
): AgentLoginHandle {
  let server: CodexLoginServer | null = null;
  // A property, not a local: settle() flips it from closures (cancel, notifications) between the
  // awaits below, which control-flow narrowing on a plain boolean would misread as impossible.
  const state = { settled: false };

  const settle = (ok: boolean, error?: string): void => {
    if (state.settled) return;
    state.settled = true;
    const current = server;
    server = null;
    // Deliberate close: kills the child (and its callback server); onExit stays silent for it.
    current?.close();
    callbacks.onSettled({ ok, ...(error !== undefined && { error }) });
  };

  void (async () => {
    let srv: CodexLoginServer;
    try {
      srv = await startServer({
        binaryPath,
        onNotification(method, params) {
          if (method !== 'account/login/completed' || !isRecord(params)) return;
          if (params.success === true) settle(true);
          else settle(false, stringField(params, 'error') ?? 'login failed');
        },
        // Fires only for a crash mid-login — a settle's deliberate close never reaches here.
        onExit(_code, stderrTail) {
          settle(false, stderrTail || 'codex exited during login');
        },
      });
    } catch (err) {
      settle(false, extractErrorMessage(err) ?? 'codex login failed to start');
      return;
    }
    if (state.settled) {
      // Cancelled while the app-server was still starting — reap the late child.
      srv.close();
      return;
    }
    server = srv;
    try {
      const response = await srv.request('account/login/start', { type: 'chatgpt' });
      const authUrl = isRecord(response) ? stringField(response, 'authUrl') : undefined;
      if (!authUrl) {
        settle(false, 'codex did not return a login URL');
        return;
      }
      if (!state.settled) callbacks.onUrl(authUrl);
    } catch (err) {
      settle(false, extractErrorMessage(err) ?? 'codex login failed to start');
    }
  })();

  return {
    // Codex completes on its own localhost callback — there is no code to hand back.
    submitCode: noop,
    cancel: () => settle(false, 'login cancelled'),
  };
}
