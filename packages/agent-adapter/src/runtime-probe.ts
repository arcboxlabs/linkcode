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

/** Platform binary name for the agent kinds that spawn an external CLI. */
export function agentBinaryName(kind: 'claude-code' | 'codex'): string {
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
  kind: 'claude-code' | 'codex';
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

let detected: DetectedAgentRuntimes = {};

/**
 * Probe the known install locations for user-installed agent CLIs. The daemon runs this once per
 * boot — user CLIs self-update, so results must not persist across boots — and adapters read the
 * outcome synchronously via `detectedRuntime()` when building spawn options.
 */
export async function probeDetectedRuntimes(
  locationsFor: (binary: string) => string[] = knownLocations,
): Promise<DetectedAgentRuntimes> {
  const next: DetectedAgentRuntimes = {};
  await Promise.all(
    PROBES.map(async ({ kind, parseVersion }) => {
      for (const location of locationsFor(agentBinaryName(kind))) {
        const runtime = await probeRuntimeAt(location, parseVersion);
        if (runtime) {
          next[kind] = runtime;
          return;
        }
      }
    }),
  );
  detected = next;
  return next;
}

export function detectedRuntime(kind: AgentKind): DetectedAgentRuntime | undefined {
  return detected[kind];
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
export function resolveAgentBinary(kind: 'claude-code' | 'codex'): string | undefined {
  return vendoredAgentBinary(kind, agentBinaryName(kind)) ?? detectedRuntime(kind)?.path;
}

/**
 * Availability of every agent runtime this host has evaluated, for the `agent-runtime.list` wire
 * resource. Runs the detection probe; call once at daemon boot. opencode is absent until it moves
 * off PATH-spawning (CODE-76); `source: 'sdk'` entries carry no binary facts — the SDK's own
 * resolution is attempted only at session start.
 */
export async function collectAgentRuntimes(
  locationsFor?: (binary: string) => string[],
): Promise<AgentRuntimes> {
  const detectedRuntimes = await probeDetectedRuntimes(locationsFor);
  const runtimes: AgentRuntimes = { pi: { status: 'available', source: 'builtin' } };
  for (const { kind, parseVersion } of PROBES) {
    const bundled = vendoredAgentBinary(kind, agentBinaryName(kind));
    if (bundled) {
      // Version is probed (not read from a stamp) so bundled and detected report the same fact.
      const probed = await probeRuntimeAt(bundled, parseVersion);
      runtimes[kind] = { status: 'available', source: 'bundled', path: bundled, ...probed };
    } else {
      const found = detectedRuntimes[kind];
      runtimes[kind] = found
        ? { status: 'available', source: 'detected', ...found }
        : { status: 'available', source: 'sdk' };
    }
  }
  return runtimes;
}
