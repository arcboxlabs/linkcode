import type { AgentKind, AgentRuntimes } from '@linkcode/schema';
import { AmpProbe } from './amp';
import type { AgentCliProbe, DetectedAgentRuntime, ProbeableKind } from './base';
import { ClaudeCodeProbe } from './claude-code';
import { CodexProbe } from './codex';

export type DetectedAgentRuntimes = Partial<Record<AgentKind, DetectedAgentRuntime>>;

/**
 * Which agent CLIs this host can spawn, orchestrating one {@link AgentCliProbe} per agent kind.
 * Holds the boot-time detection state: the daemon calls `probe()` (directly or via `collect()`)
 * once per boot — user CLIs self-update, so results must not outlive a boot — and adapters
 * resolve spawn paths synchronously through the same instance when building spawn options.
 */
export class AgentRuntimeProber {
  private detected: DetectedAgentRuntimes = {};
  private managedResolver: ((kind: ProbeableKind) => string | undefined) | undefined;

  constructor(
    private readonly probes: AgentCliProbe[] = [
      new ClaudeCodeProbe(),
      new CodexProbe(),
      new AmpProbe(),
    ],
  ) {}

  /**
   * Wire the daemon's managed-asset store into spawn resolution. A live function, not a
   * snapshot: managed installs complete in the background after boot and must win as soon
   * as they land on disk.
   */
  setManagedResolver(resolver: (kind: ProbeableKind) => string | undefined): void {
    this.managedResolver = resolver;
  }

  /** Probe the known install locations for user-installed agent CLIs. */
  async probe(): Promise<DetectedAgentRuntimes> {
    const next: DetectedAgentRuntimes = {};
    await Promise.all(
      this.probes.map(async (probe) => {
        const runtime = await probe.detect();
        if (runtime) next[probe.kind] = runtime;
      }),
    );
    this.detected = next;
    return next;
  }

  detectedRuntime(kind: AgentKind): DetectedAgentRuntime | undefined {
    return this.detected[kind];
  }

  /**
   * Resolution order for the CLI an adapter spawns: managed (the exact SDK-paired binary the
   * daemon's asset store installed) → detected (user-installed, version-verified at boot) →
   * `undefined` (the SDK resolves its own platform package out of node_modules — dev and
   * standalone daemons). Managed outranks detected because it is the SDK-pinned pair; detected
   * outranks SDK self-resolution because in packaged hosts the latter lands inside the asar
   * (spawn-hostile and host-arch only). Once the compat manifest (CODE-77) lands, detected
   * runtimes are additionally gated by version range here.
   */
  resolveBinary(kind: ProbeableKind): string | undefined {
    if (!this.probes.some((candidate) => candidate.kind === kind)) return undefined;
    return this.managedResolver?.(kind) ?? this.detected[kind]?.path;
  }

  /**
   * Binary path for an interactive `auth login`: the same managed/detected spawn path, falling back
   * to the SDK's platform binary in dev/standalone daemons — where {@link resolveBinary} is
   * `undefined` (the SDK self-resolves at session start) but the CLI still ships in node_modules and
   * a login needs a concrete executable to spawn.
   */
  loginBinaryPath(kind: ProbeableKind): string | undefined {
    const probe = this.probes.find((candidate) => candidate.kind === kind);
    if (!probe) return undefined;
    return this.resolveBinary(kind) ?? probe.sdkPlatformBinaryPath();
  }

  /**
   * Availability of every agent runtime this host has evaluated, for the `agent-runtime.list` wire
   * resource. Re-runs the detection probe. opencode is absent until it moves off PATH-spawning
   * (CODE-76); `source: 'sdk'` entries carry no binary facts — the SDK's own resolution is
   * attempted only at session start.
   */
  async collect(): Promise<AgentRuntimes> {
    const detected = await this.probe();
    const runtimes: AgentRuntimes = { pi: { status: 'available', source: 'builtin' } };
    await Promise.all(
      this.probes.map(async (probe) => {
        const managed = this.managedResolver?.(probe.kind);
        if (managed) {
          // Version is probed (not read from the store) so managed and detected report the same fact.
          const [probed, auth] = await Promise.all([
            probe.probeAt(managed),
            probe.probeAuth(managed),
          ]);
          runtimes[probe.kind] = {
            status: 'available',
            source: 'managed',
            path: managed,
            ...probed,
            ...(auth && { auth }),
          };
          return;
        }
        const found = detected[probe.kind];
        if (found) {
          const auth = await probe.probeAuth(found.path);
          runtimes[probe.kind] = {
            status: 'available',
            source: 'detected',
            ...found,
            ...(auth && { auth }),
          };
          return;
        }
        if (probe.sdkPlatformPackagePresent()) {
          // The SDK resolves the spawn path itself, but auth still probes the platform binary.
          const sdkPath = probe.sdkPlatformBinaryPath();
          const auth = sdkPath ? await probe.probeAuth(sdkPath) : undefined;
          runtimes[probe.kind] = { status: 'available', source: 'sdk', ...(auth && { auth }) };
          return;
        }
        // Packaged hosts exclude the platform packages (CODE-114): with no detected install either,
        // this agent genuinely cannot run — do not advertise it.
        runtimes[probe.kind] = { status: 'missing' };
      }),
    );
    return runtimes;
  }
}

/** The host-wide instance: the daemon probes it at boot; adapters resolve spawn paths through it. */
export const agentRuntimeProber = new AgentRuntimeProber();
