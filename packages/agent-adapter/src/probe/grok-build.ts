import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { AgentCliProbe } from './base';

const RE_GROK_VERSION = /^grok\s+(\d+\.\d+\.\d+(?:-\S+)?)/;

function grokInstallLocations(): string[] {
  const home = homedir();
  const name = process.platform === 'win32' ? 'grok.exe' : 'grok';
  switch (process.platform) {
    case 'darwin':
      return [
        join(home, '.local', 'bin', name),
        join(home, '.grok', 'bin', name),
        // Official install also ships `agent` as an alias of the same binary.
        join(home, '.grok', 'bin', 'agent'),
        join('/opt/homebrew/bin', name),
        join('/usr/local/bin', name),
      ];
    case 'linux':
      return [
        join(home, '.local', 'bin', name),
        join(home, '.grok', 'bin', name),
        join(home, '.grok', 'bin', 'agent'),
        join('/home/linuxbrew/.linuxbrew/bin', name),
        join('/usr/local/bin', name),
      ];
    default:
      return [];
  }
}

/**
 * Detect a user-installed Grok Build CLI. There is no SDK platform package in node_modules —
 * install is via https://x.ai/cli (`~/.local/bin/grok` / `~/.grok/bin/grok`).
 *
 * `grok --version` prints `grok 0.2.102 (ab5ebf69acec)` (verified).
 */
export class GrokBuildProbe extends AgentCliProbe {
  readonly kind = 'grok-build' as const;
  protected readonly binaryBase = 'grok';
  /** No in-tree SDK carrier; sdk presence checks always fail closed (user-install only). */
  protected readonly sdkPackage = '@xai-official/grok';

  /** @param locations test seam — overrides the per-platform known install locations. */
  constructor(private readonly locationOverrides?: string[]) {
    super(locationOverrides);
  }

  override knownLocations(): string[] {
    if (this.locationOverrides) return this.locationOverrides;
    return [...new Set([...super.knownLocations(), ...grokInstallLocations()])];
  }

  parseVersion(stdout: string): string | undefined {
    return RE_GROK_VERSION.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    return 'grok';
  }

  override sdkPlatformPackagePresent(): boolean {
    return false;
  }

  override sdkPlatformBinaryPath(): string | undefined {
    return undefined;
  }
}
