import { AgentCliProbe } from './base';

/**
 * The legacy SDK's `execute()` resolves its own binary via `require.resolve('@sourcegraph/amp')` —
 * a node_modules-only lookup with NO `AMP_CLI_PATH`/`$AMP_HOME`/PATH fallback (verified against the
 * pinned `@sourcegraph/amp-sdk` dist) — so `sdkPlatformPackagePresent()` (does `@sourcegraph/amp`
 * resolve?) is the only signal that predicts a live turn, and no known-install-location scan
 * applies. This probe therefore only powers the `agent-runtime.list` availability surface.
 */
export class AmpProbe extends AgentCliProbe {
  readonly kind = 'amp' as const;
  protected readonly binaryBase = 'amp';
  /** The SDK package; its CLI carrier `@sourcegraph/amp` installs as a same-scope sibling. Unlike
   * neo there are NO per-platform variants — `@sourcegraph/amp` is a pure-JS bundle. */
  protected readonly sdkPackage = '@sourcegraph/amp-sdk';

  constructor(locations?: string[]) {
    // Legacy's findAmpCommand() resolves only from node_modules — there is no standalone install
    // location to probe, so `sdkPlatformPackagePresent()` is the sole availability signal.
    // `locations` stays a pure test seam; the default is empty so detect() finds nothing.
    super(locations ?? []);
  }

  /** `amp --version` prints e.g. `0.0.1777185893-gae6d40 (released 2026-04-26T06:48:40.597Z,
   * 2mo ago)` (observed); the `(released <iso date>` marker is the vendor signature — identical
   * format across legacy and neo, so the regex is unchanged. */
  parseVersion(stdout: string): string | undefined {
    return /^(\d+\.\d+\.\d+(?:-\S+)?) \(released \d{4}-/.exec(stdout.trim())?.[1];
  }

  protected platformPackageBase(): string {
    // Legacy's CLI carrier is `@sourcegraph/amp` itself (a pure-JS bundle, no os/arch suffix).
    return 'amp';
  }
}
