import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import type { AgentKind, AgentRuntimes } from '@linkcode/schema';
import { vendoredAgentBinary } from './native/agent-bin';

const execFileAsync = promisify(execFile);

/** A user-installed agent CLI found at a known install location and version-verified. */
export interface DetectedAgentRuntime {
  path: string;
  version: string;
}

export type DetectedAgentRuntimes = Partial<Record<AgentKind, DetectedAgentRuntime>>;

/** The agent kinds that spawn an external CLI (pi is in-process; opencode is PATH-based until CODE-76). */
type ProbeableKind = 'claude-code' | 'codex';

/** Platform binary name for the agent kinds that spawn an external CLI. */
export function agentBinaryName(kind: ProbeableKind): string {
  const base = kind === 'claude-code' ? 'claude' : 'codex';
  return process.platform === 'win32' ? `${base}.exe` : base;
}

/**
 * Absolute install locations probed in order. PATH is deliberately not searched: a probe both
 * locates and *executes* the candidate, so only well-known installer targets qualify (npm-global
 * prefixes vary per machine and are skipped for the same reason). Windows locations are
 * unverified — detection degrades to "nothing detected" there (bundled/SDK resolution still
 * applies) until CODE-113's win runner pins them down.
 */
function knownLocations(binary: string): string[] {
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

/** `claude --version` prints `2.1.202 (Claude Code)`; the marker rejects impostor binaries. */
export function parseClaudeVersion(stdout: string): string | undefined {
  return /^(\d+\.\d+\.\d+(?:-\S+)?) \(Claude Code\)/.exec(stdout.trim())?.[1];
}

/** `codex --version` prints `codex-cli 0.142.4`. */
export function parseCodexVersion(stdout: string): string | undefined {
  return /^codex-cli (\d+\.\d+\.\d+(?:-\S+)?)/.exec(stdout.trim())?.[1];
}

interface ProbeSpec {
  kind: ProbeableKind;
  parseVersion: (stdout: string) => string | undefined;
}

const PROBES: ProbeSpec[] = [
  { kind: 'claude-code', parseVersion: parseClaudeVersion },
  { kind: 'codex', parseVersion: parseCodexVersion },
];

/**
 * Version-probe one candidate binary. `undefined` means "not this one" — absent, not executable,
 * hung past the timeout, or `--version` output missing the vendor marker; a failed candidate is a
 * normal probe outcome, not an error to surface.
 */
export async function probeRuntimeAt(
  file: string,
  parseVersion: (stdout: string) => string | undefined,
): Promise<DetectedAgentRuntime | undefined> {
  if (!existsSync(file)) return undefined;
  try {
    const { stdout } = await execFileAsync(file, ['--version'], { timeout: 5000 });
    const version = parseVersion(stdout);
    return version ? { path: file, version } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which agent CLIs this host can spawn. Holds the boot-time detection state: the daemon calls
 * `probe()` (directly or via `collect()`) once per boot — user CLIs self-update, so results must
 * not outlive a boot — and adapters resolve spawn paths synchronously through the same instance
 * when building spawn options.
 */
export class AgentRuntimeProber {
  private detected: DetectedAgentRuntimes = {};

  /** @param locationsFor test seam — overrides the per-platform known install locations. */
  constructor(private readonly locationsFor: (binary: string) => string[] = knownLocations) {}

  /** Probe the known install locations for user-installed agent CLIs. */
  async probe(): Promise<DetectedAgentRuntimes> {
    const next: DetectedAgentRuntimes = {};
    await Promise.all(
      PROBES.map(async ({ kind, parseVersion }) => {
        for (const location of this.locationsFor(agentBinaryName(kind))) {
          // eslint-disable-next-line no-await-in-loop -- locations are a precedence list; the first verified install wins
          const runtime = await probeRuntimeAt(location, parseVersion);
          if (runtime) {
            next[kind] = runtime;
            return;
          }
        }
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
    return vendoredAgentBinary(kind, agentBinaryName(kind)) ?? this.detected[kind]?.path;
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
      PROBES.map(async ({ kind, parseVersion }) => {
        const bundled = vendoredAgentBinary(kind, agentBinaryName(kind));
        if (bundled) {
          // Version is probed (not read from a stamp) so bundled and detected report the same fact.
          const probed = await probeRuntimeAt(bundled, parseVersion);
          runtimes[kind] = { status: 'available', source: 'bundled', path: bundled, ...probed };
        } else {
          const found = detected[kind];
          runtimes[kind] = found
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
