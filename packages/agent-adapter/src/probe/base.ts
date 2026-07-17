import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
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
 * Candidate paths from the daemon's own PATH, searched ahead of the fallback locations
 * (CODE-220): PATH is the user's declared resolution order, and its order decides which of
 * several installs wins. Deriving candidates executes nothing — verification stays in
 * `probeAt`'s `--version` vendor marker — so only entries that don't denote a fixed location
 * are dropped: relative and empty segments (both resolve against the daemon's incidental cwd).
 * npm's Windows `.cmd` shims are skipped implicitly (only `<dir>/<binary>` with the platform
 * suffix is probed; `execFile` can't run a shim anyway) — those installs ride the managed tier.
 */
function pathInstallLocations(binary: string): string[] {
  const locations: string[] = [];
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    // Windows PATH entries with spaces are conventionally double-quoted.
    const dir = entry.replaceAll('"', '');
    if (dir.length > 0 && isAbsolute(dir)) locations.push(join(dir, binary));
  }
  return locations;
}

/**
 * Fallback absolute install locations, probed after the PATH scan for daemons whose PATH was
 * stripped by a GUI launch (macOS launchd passes only `/usr/bin:/bin:/usr/sbin:/sbin`).
 * win32 has no entries: Windows GUI processes inherit the registry-composed user PATH, which
 * installers (winget Links, claude's `%USERPROFILE%\.local\bin`, scoop shims) join by design,
 * so the PATH scan already covers them.
 */
function fallbackInstallLocations(binary: string): string[] {
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
      // /usr/bin is where distro packages land (e.g. Arch's codex).
      return [
        join(home, '.local', 'bin', binary),
        join('/home/linuxbrew/.linuxbrew/bin', binary),
        join('/usr/local/bin', binary),
        join('/usr/bin', binary),
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

  /** @param locations test seam — overrides the PATH scan and the per-platform fallback locations. */
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
    if (this.locations) return this.locations;
    const binary = this.binaryName();
    return [...new Set([...pathInstallLocations(binary), ...fallbackInstallLocations(binary)])];
  }

  /** Version-probe one candidate binary. `undefined` means "not this one" (absent, not executable,
   * hung, or missing the vendor marker) — a failed candidate is a normal outcome, not an error. */
  async probeAt(file: string): Promise<DetectedAgentRuntime | undefined> {
    if (!existsSync(file)) return undefined;
    try {
      // 10s: Windows Defender's first-touch scan can stall a binary's first exec past 5s.
      const { stdout } = await execFileAsync(file, ['--version'], { timeout: 10_000 });
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
