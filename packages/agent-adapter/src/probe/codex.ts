import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import type { AgentAuthStatus } from '@linkcode/schema';
import { resolveCodexBinaryPath } from '../native/codex/app-server';
import { AgentCliProbe } from './base';

const execFileAsync = promisify(execFile);

export class CodexProbe extends AgentCliProbe {
  readonly kind = 'codex' as const;
  protected readonly binaryBase = 'codex';
  /** No JS SDK since the app-server rewrite — `@openai/codex` is the CLI carrier package whose
   * platform binaries install as same-scope siblings. */
  protected readonly sdkPackage = '@openai/codex';

  /** `codex --version` prints `codex-cli 0.142.4`. */
  parseVersion(stdout: string): string | undefined {
    return /^codex-cli (\d+\.\d+\.\d+(?:-\S+)?)/.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    return `codex-${process.platform}-${process.arch}`;
  }

  /** codex nests its CLI under `vendor/<triple>/bin/` inside the platform package, so the shared
   * package-root lookup finds nothing — delegate to the app-server module's own resolver. */
  override sdkPlatformBinaryPath(): string | undefined {
    try {
      return resolveCodexBinaryPath();
    } catch {
      return undefined;
    }
  }

  /**
   * Login status via `codex login status` — text only, no machine-readable flag exists (verified
   * on codex-cli 0.144.1): signed in prints on stdout (exit 0), signed out prints `Not logged in`
   * on STDERR (exit 1), so both streams are parsed regardless of exit code. Reads the same
   * `$CODEX_HOME/auth.json` a spawned app-server loads; unrecognized output fails open to `undefined`.
   */
  override async probeAuth(file: string): Promise<AgentAuthStatus | undefined> {
    let output = '';
    try {
      const { stdout, stderr } = await execFileAsync(file, ['login', 'status'], { timeout: 5000 });
      output = `${stdout}\n${stderr}`;
    } catch (err) {
      const { stdout, stderr } = err as { stdout?: unknown; stderr?: unknown };
      output = `${typeof stdout === 'string' ? stdout : ''}\n${typeof stderr === 'string' ? stderr : ''}`;
    }
    return parseCodexLoginStatus(output);
  }
}

/** Narrow `codex login status` output (either stream) to {@link AgentAuthStatus}. `undefined`
 * (fail-open) for unrecognized wording — a rephrasing CLI degrades to "unknown" instead of
 * wrongly blocking a signed-in user. */
export function parseCodexLoginStatus(output: string): AgentAuthStatus | undefined {
  if (/^Not logged in\b/m.test(output)) return { loggedIn: false };
  if (/^Logged in using ChatGPT\b/m.test(output)) return { loggedIn: true, method: 'chatgpt' };
  if (/^Logged in using an API key\b/m.test(output)) return { loggedIn: true, method: 'apikey' };
  return undefined;
}
