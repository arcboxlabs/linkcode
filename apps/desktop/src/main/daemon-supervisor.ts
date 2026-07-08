import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DAEMON_EXIT_ALREADY_RUNNING } from '@linkcode/schema';
import type { UtilityProcess } from 'electron';
import { app, utilityProcess } from 'electron';
import log from 'electron-log';
import { getSettings } from './settings';

/**
 * Supervises the bundled daemon (out/daemon/index.mjs, see electron.vite.config.ts): forks it
 * under Electron's Node via `utilityProcess` and ties its lifetime to the app — started when the
 * app is ready, SIGTERMed on quit (Cmd+Q). Closing windows (Cmd+W on macOS) leaves it running.
 *
 * The supervisor just spawns; the one-daemon-per-machine contract lives in the daemon itself
 * (apps/daemon/src/runtime.ts). When another daemon already serves this machine the child exits
 * with DAEMON_EXIT_ALREADY_RUNNING and the supervisor stands down — which daemon clients dial is
 * discovery's job (runtime.json), not the supervisor's.
 */

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
  // Dev shells run the daemon from the repo.
  if (!app.isPackaged) return;
  app.on('before-quit', () => {
    quitting = true;
    if (respawnTimer !== null) clearTimeout(respawnTimer);
    child?.kill();
  });
  syncDaemonSupervisor();
}

/**
 * Spawn the daemon if this app should be managing one and is not already. Called at startup and
 * again when settings change: clearing the endpoint override mid-session must start the daemon,
 * not wait for an app restart. Setting an override leaves a running child alone — it dies with
 * the app and the one-daemon-per-machine contract keeps it harmless. A user-driven sync also
 * resets the crash-loop counter, giving a deliberate retry a fresh start.
 */
export function syncDaemonSupervisor(): void {
  if (quitting || !isDaemonManaged()) return;
  if (child !== null || respawnTimer !== null) return;
  fastExits = 0;
  spawnDaemon();
}

function spawnDaemon(): void {
  if (quitting) return;
  const startedAt = Date.now();
  const env: Record<string, string | undefined> = { ...process.env };
  const sidecar = sidecarPath();
  if (existsSync(sidecar)) env.LINKCODE_PTY_SIDECAR_PATH = sidecar;
  else log.warn(`[linkcode/desktop] pty sidecar missing at ${sidecar}; terminals unavailable`);
  // Managed agent CLI binaries (CODE-111's downloader lands them here; nothing ships builtin
  // since CODE-114). Real on-disk executables — when present, the agent adapters spawn from
  // here ahead of a detected user install. Absent on most machines today; the adapters then
  // fall back to the boot-time runtime probe's detected CLI.
  const agentBin = join(app.getPath('userData'), 'agent-bin');
  if (existsSync(agentBin)) env.LINKCODE_AGENT_BIN_DIR = agentBin;

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
    if (code === DAEMON_EXIT_ALREADY_RUNNING) {
      log.info('[linkcode/desktop] another daemon already serves this machine; standing down');
      return;
    }
    fastExits = Date.now() - startedAt < HEALTHY_AFTER_MS ? fastExits + 1 : 1;
    if (fastExits >= MAX_CONSECUTIVE_FAST_EXITS) {
      log.error(`[linkcode/desktop] daemon keeps exiting (last code ${code}); giving up`);
      return;
    }
    log.warn(`[linkcode/desktop] daemon exited (code ${code}); restarting`);
    respawnTimer = setTimeout(() => {
      respawnTimer = null;
      spawnDaemon();
    }, RESPAWN_DELAY_MS);
  });
}

function sidecarPath(): string {
  return join(
    process.resourcesPath,
    process.platform === 'win32' ? 'linkcode-pty.exe' : 'linkcode-pty',
  );
}
