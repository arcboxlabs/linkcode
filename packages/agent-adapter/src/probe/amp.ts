import { homedir } from 'node:os';
import { join } from 'node:path';
import process, { env } from 'node:process';
import { AgentCliProbe, defaultInstallLocations } from './base';

/**
 * Unlike claude/codex, the detected path is NOT handed to the SDK at spawn time — `execute()`
 * resolves its own binary (node_modules pair → `AMP_CLI_PATH` → `$AMP_HOME` → PATH) and offers no
 * per-call override, so this probe only powers the `agent-runtime.list` availability surface. The
 * history module mirrors the SDK's own resolution instead of consulting the probe, keeping
 * history reads and live turns on the same binary.
 */
export class AmpProbe extends AgentCliProbe {
  readonly kind = 'amp' as const;
  protected readonly binaryBase = 'amp';
  /** The SDK package; the CLI carrier `@ampcode/cli`'s platform packages install as same-scope
   * siblings (`@ampcode/cli-<platform>-<arch>`). */
  protected readonly sdkPackage = '@ampcode/sdk';

  constructor(locations?: string[]) {
    // Mirror the SDK's own $AMP_HOME lookup order (sdk/bin before bin, matching history.ts's
    // resolveAmpCli) ahead of the shared installer locations, so the probe reports availability
    // for the same binary a live turn / history read would actually resolve.
    const binary = process.platform === 'win32' ? 'amp.exe' : 'amp';
    const ampHome = env.AMP_HOME ?? join(homedir(), '.amp');
    super(
      locations ?? [
        join(ampHome, 'sdk', 'bin', binary),
        join(ampHome, 'bin', binary),
        ...defaultInstallLocations(binary),
      ],
    );
  }

  /** `amp --version` prints `0.0.1783401425-gc7fcc1 (released 2026-07-07T05:17:05.000Z, 1d ago)`;
   * the `(released <iso date>` suffix is the vendor marker. */
  parseVersion(stdout: string): string | undefined {
    return /^(\d+\.\d+\.\d+(?:-\S+)?) \(released \d{4}-/.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    return `cli-${process.platform}-${process.arch}`;
  }
}
