import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { daemonRuntimeFilePath, isPidAlive, readJsonFileSync } from '@linkcode/common/node';
import {
  DAEMON_IDENTITY_PATH,
  DaemonIdentitySchema,
  DaemonRuntimeInfoSchema,
} from '@linkcode/schema';
import type { UtilityProcess } from 'electron';
import { app, utilityProcess } from 'electron';
import log from 'electron-log';
import { getSettings } from './settings';

/**
 * Supervises the bundled daemon (out/daemon/index.mjs, see electron.vite.config.ts): forks it
 * under Electron's Node via `utilityProcess` and ties its lifetime to the app — started when the
 * app is ready, SIGTERMed on quit (Cmd+Q). Closing windows (Cmd+W on macOS) leaves it running.
 * An externally managed daemon (a dev `pnpm -F @linkcode/daemon dev`, another shell's supervisor)
 * always wins: the daemon is one-per-machine, so the supervisor adopts it instead of spawning.
 */

const PROBE_TIMEOUT_MS = 1000;
const RESPAWN_DELAY_MS = 1000;
/** A child that lived at least this long resets the crash-loop counter. */
const HEALTHY_AFTER_MS = 30000;
const MAX_CONSECUTIVE_FAST_EXITS = 5;

let child: UtilityProcess | null = null;
let respawnTimer: NodeJS.Timeout | null = null;
let quitting = false;
let fastExits = 0;

/** True when this app owns the daemon's lifecycle — drives the connection-failure copy. */
export function isDaemonManaged(): boolean {
  return app.isPackaged && getSettings().daemonUrl === null;
}

export function startDaemonSupervisor(): void {
  // Dev shells run the daemon from the repo; an explicit endpoint override means the user
  // manages the daemon themselves.
  if (!isDaemonManaged()) return;
  app.on('before-quit', () => {
    quitting = true;
    if (respawnTimer !== null) clearTimeout(respawnTimer);
    child?.kill();
  });
  void ensureDaemon();
}

async function ensureDaemon(): Promise<void> {
  if (quitting) return;
  if (await findLiveDaemon()) {
    log.info('[linkcode/desktop] adopting the already-running daemon');
    return;
  }
  spawnDaemon();
}

function spawnDaemon(): void {
  const startedAt = Date.now();
  const env: Record<string, string | undefined> = { ...process.env };
  const sidecar = sidecarPath();
  if (existsSync(sidecar)) env.LINKCODE_PTY_SIDECAR_PATH = sidecar;
  else log.warn(`[linkcode/desktop] pty sidecar missing at ${sidecar}; terminals unavailable`);

  const proc = utilityProcess.fork(join(__dirname, '../daemon/index.mjs'), [], {
    serviceName: 'linkcode-daemon',
    stdio: 'pipe',
    env,
  });
  child = proc;
  proc.stdout?.on('data', (chunk: Buffer) => log.info(chunk.toString().trimEnd()));
  proc.stderr?.on('data', (chunk: Buffer) => log.warn(chunk.toString().trimEnd()));
  proc.on('exit', (code) => {
    child = null;
    if (quitting) return;
    fastExits = Date.now() - startedAt < HEALTHY_AFTER_MS ? fastExits + 1 : 1;
    if (fastExits >= MAX_CONSECUTIVE_FAST_EXITS) {
      log.error(`[linkcode/desktop] daemon keeps exiting (last code ${code}); giving up`);
      return;
    }
    log.warn(`[linkcode/desktop] daemon exited (code ${code}); restarting`);
    respawnTimer = setTimeout(() => {
      respawnTimer = null;
      void ensureDaemon();
    }, RESPAWN_DELAY_MS);
  });
}

/**
 * Whether a live daemon is already serving this machine — same contract as the daemon's own
 * `findRunningDaemon` (apps/daemon/src/runtime.ts): runtime file present, advertised pid alive,
 * and the endpoint answering `GET /linkcode` as that pid. `false` covers "no daemon" by contract,
 * not as a swallowed error — any probe failure means there is nothing to adopt.
 */
async function findLiveDaemon(): Promise<boolean> {
  const parsed = DaemonRuntimeInfoSchema.safeParse(readJsonFileSync(daemonRuntimeFilePath()));
  if (!parsed.success || !isPidAlive(parsed.data.pid)) return false;
  try {
    const probeBase = new URL(parsed.data.listeners[0].url);
    probeBase.protocol = probeBase.protocol === 'wss:' ? 'https:' : 'http:';
    const res = await fetch(new URL(DAEMON_IDENTITY_PATH, probeBase), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const identity = DaemonIdentitySchema.safeParse(await res.json());
    return identity.success && identity.data.pid === parsed.data.pid;
  } catch {
    return false;
  }
}

function sidecarPath(): string {
  return join(
    process.resourcesPath,
    process.platform === 'win32' ? 'linkcode-pty.exe' : 'linkcode-pty',
  );
}
