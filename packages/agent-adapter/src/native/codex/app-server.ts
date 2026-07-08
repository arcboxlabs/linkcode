import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { env as processEnv } from 'node:process';
import { createInterface } from 'node:readline';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { isRecord } from '../../history-util';

/**
 * Minimal JSON-RPC client for `codex app-server` (line-delimited JSON over stdio) — the protocol
 * behind the official VS Code extension. Unlike `@openai/codex-sdk` (a one-shot `codex exec`
 * wrapper), this surface supports per-tool approval round-trips, per-turn model/effort overrides,
 * structured file-change diffs, and turn interruption — everything the adapter needs for parity
 * with claude-code.
 *
 * Framing follows the server's own dialect: requests/responses carry `{id, method?, params?}`
 * with no `jsonrpc` envelope field (verified against codex-cli 0.140.0, which accepts both but
 * replies without it).
 */

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

function targetTriple(): string | null {
  switch (process.platform) {
    case 'linux':
    case 'android':
      if (process.arch === 'x64') return 'x86_64-unknown-linux-musl';
      if (process.arch === 'arm64') return 'aarch64-unknown-linux-musl';
      return null;
    case 'darwin':
      if (process.arch === 'x64') return 'x86_64-apple-darwin';
      if (process.arch === 'arm64') return 'aarch64-apple-darwin';
      return null;
    case 'win32':
      if (process.arch === 'x64') return 'x86_64-pc-windows-msvc';
      if (process.arch === 'arm64') return 'aarch64-pc-windows-msvc';
      return null;
    default:
      return null;
  }
}

/**
 * Locate the native `codex` binary shipped by `@openai/codex`'s platform-specific optional
 * dependency (vendor/<triple>/bin/codex) — the node_modules self-resolution tier for dev shells
 * and standalone daemons, mirroring what `@openai/codex-sdk` used to do. Packaged apps exclude
 * the platform packages (CODE-114), so callers must prefer `agentRuntimeProber.resolveBinary`
 * (managed dir / detected user install) and fall back here only when it yields nothing.
 */
export function resolveCodexBinaryPath(): string {
  const triple = targetTriple();
  if (!triple) {
    throw new Error(`codex: unsupported platform ${process.platform} (${process.arch})`);
  }
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple];
  const require = createRequire(import.meta.url);
  let vendorRoot: string;
  try {
    const codexPackageJson = require.resolve('@openai/codex/package.json');
    const codexRequire = createRequire(codexPackageJson);
    const platformPackageJson = codexRequire.resolve(`${platformPackage}/package.json`);
    vendorRoot = join(dirname(platformPackageJson), 'vendor');
  } catch (err) {
    throw new Error(
      `codex: unable to locate the Codex CLI. Ensure '@openai/codex' is installed with optional dependencies (${extractErrorMessage(err) ?? 'resolve failed'})`,
      { cause: err },
    );
  }
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const binaryPath = join(vendorRoot, triple, 'bin', binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error(`codex: CLI binary not found at ${binaryPath}`);
  }
  return binaryPath;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/** Handler for a server→client request (approvals); the resolved value is sent back as `result`. */
export type ServerRequestHandler = (params: unknown) => Promise<unknown>;

const STDERR_TAIL_LIMIT = 2048;

export interface CodexAppServerOptions {
  /** Absolute path of the `codex` binary to spawn — resolved by the caller (runtime prober
   * first, node_modules fallback) so this client stays free of resolution policy. */
  binaryPath: string;
  /** Extra environment for the subprocess (e.g. CODEX_API_KEY); merged over the inherited env. */
  env?: Record<string, string>;
  onNotification: (method: string, params: unknown) => void;
  /** Called once when the subprocess exits, with null code on signal kills and the tail of the
   * process's stderr as diagnostic detail. */
  onExit: (code: number | null, stderrTail: string) => void;
}

export class CodexAppServer {
  private nextRequestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestHandlers = new Map<string, ServerRequestHandler>();
  private closed = false;
  private stderrTail = '';

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly opts: CodexAppServerOptions,
  ) {
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => this.handleLine(line));
    // stdin errors (EPIPE when the process dies mid-write) must not crash the host; the 'exit'
    // handler is what surfaces the failure.
    child.stdin.on('error', noop);
    // stderr must be drained or a chatty process eventually fills the OS pipe buffer and stalls;
    // keep only a small tail for diagnostics.
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
    });
    child.on('error', (err) => this.failAllPending(err));
    child.on('exit', (code) => {
      this.failAllPending(
        new Error(`codex: app-server exited (code ${String(code)}) ${this.stderrTail}`.trim()),
      );
      if (!this.closed) opts.onExit(code, this.stderrTail.trim());
    });
  }

  /** Spawn the app-server and complete the `initialize`/`initialized` handshake. */
  static async start(this: void, opts: CodexAppServerOptions): Promise<CodexAppServer> {
    const child = spawn(opts.binaryPath, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...processEnv, ...opts.env },
    });
    const server = new CodexAppServer(child, opts);
    try {
      await server.request('initialize', {
        clientInfo: { name: 'linkcode', title: 'Link Code', version: '0.0.0' },
        // Experimental opt-in matches what established app-server clients negotiate; the methods
        // this client consumes are the stable thread/turn/item core.
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
    } catch (err) {
      // A binary that answers `initialize` with an error (e.g. a detected install too old to
      // speak app-server) leaves a live child behind — reap it before surfacing the failure.
      server.close();
      throw err;
    }
    server.notify('initialized', {});
    return server;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('codex: app-server connection is closed'));
    this.nextRequestId += 1;
    const id = this.nextRequestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  /** Register the handler answering a server→client request method (e.g. approvals). */
  setRequestHandler(method: string, handler: ServerRequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAllPending(new Error('codex: app-server connection is closed'));
    this.child.kill();
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (line.trim().length === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Non-JSON noise on stdout; ignore.
    }
    if (!isRecord(message)) return;
    const { id, method } = message;
    if (typeof method === 'string' && (typeof id === 'number' || typeof id === 'string')) {
      void this.handleServerRequest(id, method, message.params);
      return;
    }
    if (typeof method === 'string') {
      this.opts.onNotification(method, message.params);
      return;
    }
    if (typeof id === 'number') {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if ('error' in message) {
        const error = message.error;
        const detail = isRecord(error) && typeof error.message === 'string' ? error.message : line;
        pending.reject(new Error(`codex: ${detail}`));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private async handleServerRequest(
    id: number | string,
    method: string,
    params: unknown,
  ): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      // Answer unknown server requests instead of leaving the server awaiting forever.
      this.write({ id, error: { code: -32601, message: `method '${method}' is not supported` } });
      return;
    }
    try {
      const result = await handler(params);
      this.write({ id, result });
    } catch (err) {
      this.write({
        id,
        error: { code: -32603, message: extractErrorMessage(err) ?? 'handler failed' },
      });
    }
  }

  private failAllPending(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }
}
