import { spawn as nodeSpawn } from 'node:child_process';
import type { AgentKind } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { startCodexLogin } from './native/codex/login';

/** The authorize URL claude prints as `…visit: https://…/oauth/authorize?…`. */
const CLAUDE_LOGIN_URL_RE = /https:\/\/\S*\/oauth\/authorize\S*/i;

/**
 * Extract the browser authorize URL from `claude auth login` output. Matches the literal
 * `https://…/oauth/authorize…` link, never the URL-encoded `redirect_uri` inside its query.
 */
export function parseClaudeLoginUrl(text: string): string | undefined {
  return CLAUDE_LOGIN_URL_RE.exec(text)?.[0];
}

export interface AgentLoginCallbacks {
  /** The browser authorize URL, emitted once. */
  onUrl: (url: string) => void;
  /** Terminal outcome: `ok` on a clean exit, else `error` carries the failure detail. */
  onSettled: (result: { ok: boolean; error?: string }) => void;
}

export interface AgentLoginHandle {
  /** Feed the authorization code the user pasted from the browser into the CLI's stdin. */
  submitCode: (code: string) => void;
  /** Abort the login — kills the child; a `settled` with `ok: false` follows. */
  cancel: () => void;
}

/** The child-process surface {@link startClaudeLogin} needs; node's `spawn` satisfies it structurally. */
export interface LoginChildProcess {
  stdout: { on: (event: 'data', listener: (chunk: unknown) => void) => void } | null;
  stderr: { on: (event: 'data', listener: (chunk: unknown) => void) => void } | null;
  stdin: { write: (data: string) => void } | null;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  kill: () => void;
}
export type LoginSpawn = (command: string, args: string[]) => LoginChildProcess;

/**
 * Drive `claude auth login` as a short-lived headless child (piped stdio, no PTY): authorize URL
 * out via `onUrl`, pasted code in via `submitCode` (stdin), outcome via `onSettled`. `--claudeai`
 * selects the subscription flow; the CLI's OAuth callback page is remote, so the code round-trips
 * through the user. The child inherits the daemon's environment so credentials land where the SDK
 * later reads them (macOS keychain / `~/.claude`).
 */
export function startClaudeLogin(
  binaryPath: string,
  callbacks: AgentLoginCallbacks,
  spawn: LoginSpawn = defaultSpawn,
): AgentLoginHandle {
  const child = spawn(binaryPath, ['auth', 'login', '--claudeai']);
  let buffer = '';
  let urlSent = false;
  let settled = false;
  let lastError = '';

  const scan = (chunk: unknown): void => {
    if (urlSent) return;
    buffer += String(chunk);
    const url = parseClaudeLoginUrl(buffer);
    if (url) {
      urlSent = true;
      callbacks.onUrl(url);
    }
  };
  child.stdout?.on('data', scan);
  child.stderr?.on('data', (chunk) => {
    lastError = String(chunk);
    // The prompt/URL can surface on stderr depending on the CLI's stream choice — scan both.
    scan(chunk);
  });

  const settle = (result: { ok: boolean; error?: string }): void => {
    if (settled) return;
    settled = true;
    callbacks.onSettled(result);
  };
  child.on('exit', (code) => {
    if (code === 0) {
      settle({ ok: true });
    } else {
      settle({
        ok: false,
        error: lastError.trim() || `login exited with code ${code ?? 'signal'}`,
      });
    }
  });
  child.on('error', (err) => {
    settle({ ok: false, error: extractErrorMessage(err) ?? 'login failed to start' });
  });

  return {
    submitCode: (code) => child.stdin?.write(`${code.trim()}\n`),
    cancel: () => child.kill(),
  };
}

function defaultSpawn(command: string, args: string[]): LoginChildProcess {
  // No `env` override: inherit the daemon's environment so credentials land where the SDK reads them.
  return nodeSpawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

/** Agent kinds whose CLI login LinkCode can drive headlessly; the engine rejects the rest. */
export const AGENT_LOGIN_KINDS: ReadonlySet<AgentKind> = new Set(['claude-code', 'codex']);

/**
 * Per-kind dispatcher over the two implemented flows: claude's paste-code child process and
 * codex's app-server browser callback (`native/codex/login.ts`). `undefined` = unsupported kind.
 */
export function startAgentCliLogin(
  kind: AgentKind,
  binaryPath: string,
  callbacks: AgentLoginCallbacks,
): AgentLoginHandle | undefined {
  switch (kind) {
    case 'claude-code':
      return startClaudeLogin(binaryPath, callbacks);
    case 'codex':
      return startCodexLogin(binaryPath, callbacks);
    default:
      return undefined;
  }
}
