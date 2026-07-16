import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import type { AgentAuthStatus } from '@linkcode/schema';

const execFileAsync = promisify(execFile);

/** A user-installed agent CLI found at a known install location and version-verified. */
export interface DetectedAgentRuntime {
  path: string;
  version: string;
}

/** The agent kinds that spawn an external CLI (pi is in-process; opencode is PATH-based until CODE-76). */
export type ProbeableKind = 'claude-code' | 'codex';

/**
 * Absolute install locations probed in order. PATH is deliberately not searched — a probe both
 * locates and *executes* the candidate, so only well-known installer targets qualify. Windows
 * locations are unverified: detection degrades to "nothing detected" there until CODE-113's win
 * runner pins them down.
 */
function defaultInstallLocations(binary: string): string[] {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      // Official installers target ~/.local/bin; Homebrew is /opt/homebrew (arm) or /usr/local (intel).
      return [
        join(home, '.local', 'bin', binary),
        join('/opt/homebrew/bin', binary),
        join('/usr/local/bin', binary),
      ];
    case 'linux':
      return [
        join(home, '.local', 'bin', binary),
        join('/home/linuxbrew/.linuxbrew/bin', binary),
        join('/usr/local/bin', binary),
      ];
    default:
      return [];
  }
}

/**
 * One agent's CLI probe: where its user-installed binary may live and how to verify a candidate is
 * the real vendor CLI. Subclasses declare only the binary's base name and `--version` signature.
 */
export abstract class AgentCliProbe {
  abstract readonly kind: ProbeableKind;
  protected abstract readonly binaryBase: string;
  /** The SDK JS package; its platform CLI package installs as a same-scope sibling. */
  protected abstract readonly sdkPackage: string;

  /** @param locations test seam — overrides the per-platform known install locations. */
  constructor(private readonly locations?: string[]) {}

  /** Extract the CLI version from `--version` output; `undefined` rejects an impostor binary. */
  abstract parseVersion(stdout: string): string | undefined;

  /** Basename of the npm package carrying this platform's CLI binary. */
  protected abstract platformPackageBase(): string;

  /**
   * Whether the SDK's own resolution would find a CLI in node_modules — false in packaged apps
   * (platform packages excluded, CODE-114). Checks directory presence instead of `require.resolve`
   * because the SDKs' `exports` maps reject bare CJS resolution outright.
   */
  sdkPlatformPackagePresent(): boolean {
    const scope = this.sdkPackage.split('/', 1)[0];
    const paths = createRequire(import.meta.url).resolve.paths(this.sdkPackage) ?? [];
    return paths.some((dir) => existsSync(join(dir, scope, this.platformPackageBase())));
  }

  /**
   * Absolute path to the CLI binary at the SDK's platform-package root (claude's layout).
   * `undefined` in packaged apps (platform packages excluded, CODE-114) and for CLIs whose binary
   * is nested elsewhere (codex vendors under `vendor/` and resolves its own path).
   */
  sdkPlatformBinaryPath(): string | undefined {
    const scope = this.sdkPackage.split('/', 1)[0];
    const paths = createRequire(import.meta.url).resolve.paths(this.sdkPackage) ?? [];
    for (const dir of paths) {
      const candidate = join(dir, scope, this.platformPackageBase(), this.binaryName());
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  /** Provider login status, if the CLI exposes one (claude-code overrides via `auth status`).
   * Default: no login concept — `undefined` reads as "unknown" and never blocks the UI. */
  probeAuth(_file: string): Promise<AgentAuthStatus | undefined> {
    return Promise.resolve(undefined);
  }

  binaryName(): string {
    return process.platform === 'win32' ? `${this.binaryBase}.exe` : this.binaryBase;
  }

  knownLocations(): string[] {
    return this.locations ?? defaultInstallLocations(this.binaryName());
  }

  /** Version-probe one candidate binary. `undefined` means "not this one" (absent, not executable,
   * hung, or missing the vendor marker) — a failed candidate is a normal outcome, not an error. */
  async probeAt(file: string): Promise<DetectedAgentRuntime | undefined> {
    if (!existsSync(file)) return undefined;
    try {
      const { stdout } = await execFileAsync(file, ['--version'], { timeout: 5000 });
      const version = this.parseVersion(stdout);
      return version ? { path: file, version } : undefined;
    } catch {
      return undefined;
    }
  }

  /** Probe the known install locations in order; the first verified install wins. */
  async detect(): Promise<DetectedAgentRuntime | undefined> {
    for (const location of this.knownLocations()) {
      // eslint-disable-next-line no-await-in-loop -- locations are a precedence list; the first verified install wins
      const runtime = await this.probeAt(location);
      if (runtime) return runtime;
    }
    return undefined;
  }
}
