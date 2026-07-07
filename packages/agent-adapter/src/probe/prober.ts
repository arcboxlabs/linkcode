import type { AgentKind, AgentRuntimes } from '@linkcode/schema';
import { vendoredAgentBinary } from '../native/agent-bin';
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

  constructor(
    private readonly probes: AgentCliProbe[] = [new ClaudeCodeProbe(), new CodexProbe()],
  ) {}

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
   * Resolution order for the CLI an adapter spawns: bundled (the exact SDK-paired binary staged by
   * the packaged host) → detected (user-installed, version-verified at boot) → `undefined` (the SDK
   * resolves its own platform package out of node_modules — dev and standalone daemons). Bundled
   * outranks detected because it is the CI-tested pair; detected outranks SDK self-resolution
   * because in packaged hosts the latter lands inside the asar (spawn-hostile and host-arch only).
   * Once the compat manifest (CODE-77) lands, detected runtimes are additionally gated by version
   * range here.
   */
  resolveBinary(kind: ProbeableKind): string | undefined {
    const probe = this.probes.find((candidate) => candidate.kind === kind);
    if (!probe) return undefined;
    return vendoredAgentBinary(kind, probe.binaryName()) ?? this.detected[kind]?.path;
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
        const bundled = vendoredAgentBinary(probe.kind, probe.binaryName());
        if (bundled) {
          // Version is probed (not read from a stamp) so bundled and detected report the same fact.
          const probed = await probe.probeAt(bundled);
          runtimes[probe.kind] = {
            status: 'available',
            source: 'bundled',
            path: bundled,
            ...probed,
          };
        } else {
          const found = detected[probe.kind];
          runtimes[probe.kind] = found
            ? { status: 'available', source: 'detected', ...found }
            : { status: 'available', source: 'sdk' };
        }
      }),
    );
    return runtimes;
  }
}

/** The host-wide instance: the daemon probes it at boot; adapters resolve spawn paths through it. */
export const agentRuntimeProber = new AgentRuntimeProber();
