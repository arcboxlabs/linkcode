import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { AgentCliProbe } from './base';

/** `opencode --version` prints the bare semver (`1.18.2`, verified) — no vendor marker exists,
 * so the anchored whole-output shape is the only impostor screen available. */
const RE_OPENCODE_VERSION = /^(\d+\.\d+\.\d+(?:-\S+)?)$/;

function opencodeInstallLocations(): string[] {
  const home = homedir();
  const name = process.platform === 'win32' ? 'opencode.exe' : 'opencode';
  switch (process.platform) {
    case 'darwin':
    case 'linux':
      // The official install script targets ~/.opencode/bin (verified against
      // https://opencode.ai/install); homebrew/npm installs ride the shared PATH/fallback scan.
      return [join(home, '.opencode', 'bin', name)];
    default:
      return [];
  }
}

/**
 * Detect a user-installed opencode CLI (CODE-76). The managed tier is the `agent:opencode`
 * asset (npm `opencode-<platform>-<arch>` platform packages); in-tree there is no CLI carrier —
 * `@opencode-ai/sdk` is pure JS — so sdk presence checks fail closed like grok's.
 */
export class OpencodeProbe extends AgentCliProbe {
  readonly kind = 'opencode' as const;
  protected readonly binaryBase = 'opencode';
  protected readonly sdkPackage = '@opencode-ai/sdk';

  /** @param locations test seam — overrides the per-platform known install locations. */
  constructor(private readonly locationOverrides?: string[]) {
    super(locationOverrides);
  }

  override knownLocations(): string[] {
    if (this.locationOverrides) return this.locationOverrides;
    return [...new Set([...super.knownLocations(), ...opencodeInstallLocations()])];
  }

  parseVersion(stdout: string): string | undefined {
    return RE_OPENCODE_VERSION.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    return 'opencode';
  }

  override sdkPlatformPackagePresent(): boolean {
    return false;
  }

  override sdkPlatformBinaryPath(): string | undefined {
    return undefined;
  }
}
