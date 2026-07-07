/**
 * Zero-dependency half of the daemon runtime discovery contract (see `daemon-runtime.ts`).
 * Kept zod-free so it can be imported from the sandboxed Electron preload, where
 * `require('zod')` is unavailable.
 */

/** Default TCP port of the local daemon: 0x4C43 — ascii "LC". */
export const DAEMON_DEFAULT_PORT = 19523;
export const DAEMON_DEFAULT_URL = `http://127.0.0.1:${DAEMON_DEFAULT_PORT}`;

/** Runtime discovery file the daemon writes after binding, as path segments under the user's home directory. */
export const DAEMON_RUNTIME_FILE_SEGMENTS = ['.linkcode', 'runtime.json'] as const;

/**
 * Exit code of a daemon that stood down because a live daemon already serves this machine
 * (one daemon per machine — see apps/daemon/src/runtime.ts). Supervisors treat it as
 * "someone else is serving", not as a crash to restart.
 */
export const DAEMON_EXIT_ALREADY_RUNNING = 3;
