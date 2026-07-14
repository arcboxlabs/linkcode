import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DAEMON_EXIT_ALREADY_RUNNING } from '@linkcode/schema';
import type { UtilityProcess } from 'electron';
import { app, utilityProcess } from 'electron';
import log from 'electron-log';
import { PROFILE } from './constants';
import { watchDaemonRuntime } from './daemon-discovery';
import { getSettings } from './settings';

/**
 * Supervises the bundled daemon (out/daemon/index.mjs, see electron.vite.config.ts): forks it
 * under Electron's Node via `utilityProcess` and ties its lifetime to the app — started when the
 * app is ready, SIGTERMed on quit (Cmd+Q). Closing windows (Cmd+W on macOS) leaves it running.
 *
 * The supervisor just spawns; the one-daemon-per-profile contract lives in the daemon itself
 * (apps/daemon/src/runtime.ts). When another daemon already serves this profile the child exits
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
let blockedBy: 'external-daemon' | 'crash-loop' | null = null;

/** True when this app owns the daemon's lifecycle — drives the connection-failure copy. */
export function isDaemonManaged(): boolean {
  return app.isPackaged && getSettings().daemonUrl === null;
}

export function startDaemonSupervisor(): void {
  // Dev shells run the daemon from the repo.
  if (!app.isPackaged) return;
  const unwatchRuntime = watchDaemonRuntime(syncDaemonSupervisor);
  app.on('before-quit', () => {
    quitting = true;
    unwatchRuntime();
    if (respawnTimer !== null) clearTimeout(respawnTimer);
    child?.kill();
  });
  syncDaemonSupervisor();
}

/**
 * Re-evaluate an automatic stand-down when runtime.json changes. A live external daemon makes
 * our child exit with code 3; when that daemon later stops, its runtime-file change lets this app
 * take ownership again. A crash-loop give-up is intentionally sticky until an explicit retry.
 */
function syncDaemonSupervisor(): void {
  if (quitting || !isDaemonManaged()) return;
  if (child !== null || respawnTimer !== null) return;
  if (blockedBy === 'crash-loop') return;
  blockedBy = null;
  spawnDaemon();
}

/** Explicit user retry: reset the crash budget and immediately re-arm a managed daemon. */
export function retryDaemonSupervisor(): void {
  if (quitting || !isDaemonManaged()) return;
  fastExits = 0;
  blockedBy = null;
  if (child !== null) return;
  if (respawnTimer !== null) {
    clearTimeout(respawnTimer);
    respawnTimer = null;
  }
  spawnDaemon();
}

function spawnDaemon(): void {
  // Management can be disabled while a respawn timer is pending.
  if (quitting || !isDaemonManaged()) return;
  const startedAt = Date.now();
  const env: Record<string, string | undefined> = { ...process.env };
  // The child must live in the desktop's resolved universe: a `--profile` switch outranks any
  // inherited LINKCODE_PROFILE, and the default universe must not leak a stray env value through.
  if (PROFILE === undefined) delete env.LINKCODE_PROFILE;
  else env.LINKCODE_PROFILE = PROFILE;
  const sidecar = sidecarPath();
  if (existsSync(sidecar)) env.LINKCODE_PTY_SIDECAR_PATH = sidecar;
  else log.warn(`[linkcode/desktop] pty sidecar missing at ${sidecar}; terminals unavailable`);
  // Agent CLI binaries need no env here: the daemon owns its managed-asset store
  // (@linkcode/assets, CODE-111) and resolves spawn paths managed → detected on its own.

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
      blockedBy = 'external-daemon';
      log.info('[linkcode/desktop] another daemon already serves this machine; standing down');
      return;
    }
    fastExits = Date.now() - startedAt < HEALTHY_AFTER_MS ? fastExits + 1 : 1;
    if (fastExits >= MAX_CONSECUTIVE_FAST_EXITS) {
      blockedBy = 'crash-loop';
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
