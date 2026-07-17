import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import type { AgentAuthStatus } from '@linkcode/schema';
import { AgentCliProbe } from './base';

const execFileAsync = promisify(execFile);

/** `claude --version` prints `2.1.202 (Claude Code)`; the marker rejects impostor binaries. */
const CLAUDE_VERSION_RE = /^(\d+\.\d+\.\d+(?:-\S+)?) \(Claude Code\)/;

export class ClaudeCodeProbe extends AgentCliProbe {
  readonly kind = 'claude-code' as const;
  protected readonly binaryBase = 'claude';
  protected readonly sdkPackage = '@anthropic-ai/claude-agent-sdk';

  parseVersion(stdout: string): string | undefined {
    return CLAUDE_VERSION_RE.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    // musl variants exist for linux; our artifacts are glibc, and dev machines follow suit.
    return `claude-agent-sdk-${process.platform}-${process.arch}`;
  }

  /**
   * Login status via `claude auth status --json`. The JSON rides stdout even on a non-zero exit
   * (signed out), so the payload is parsed regardless of exit code; unparseable output fails open
   * to `undefined` ("unknown", never blocks). Reads the same keychain/credentials the SDK inherits.
   */
  override async probeAuth(file: string): Promise<AgentAuthStatus | undefined> {
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync(file, ['auth', 'status', '--json'], {
        timeout: 5000,
        windowsHide: true,
      }));
    } catch (err) {
      const captured = (err as { stdout?: unknown }).stdout;
      if (typeof captured === 'string') stdout = captured;
    }
    return parseClaudeAuthStatus(stdout);
  }
}

/** Narrow the `claude auth status --json` payload to the surfaced fields. `undefined` (fail-open)
 * when the output is not JSON or lacks a boolean `loggedIn` — never a false negative that would
 * wrongly block a signed-in user. */
export function parseClaudeAuthStatus(stdout: string): AgentAuthStatus | undefined {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.loggedIn !== 'boolean') return undefined;
  return {
    loggedIn: record.loggedIn,
    method: typeof record.authMethod === 'string' ? record.authMethod : undefined,
    subscriptionType:
      typeof record.subscriptionType === 'string' ? record.subscriptionType : undefined,
    email: typeof record.email === 'string' ? record.email : undefined,
  };
}
