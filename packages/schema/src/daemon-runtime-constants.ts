/** Zero-dependency half of the daemon runtime discovery contract (see `daemon-runtime.ts`);
 * kept zod-free so the sandboxed Electron preload (no `require('zod')`) can import it. */

/** Default TCP port of the local daemon: 0x4C43 — ascii "LC". */
export const DAEMON_DEFAULT_PORT = 19523;
export const DAEMON_DEFAULT_URL = `http://127.0.0.1:${DAEMON_DEFAULT_PORT}`;

/**
 * Shape of a profile name. A profile is an isolated state universe on one machine (own daemon
 * state directory, discovery file, device identity), activated via `LINKCODE_PROFILE` (daemon)
 * or `--profile` (desktop); no profile means the default universe.
 */
export const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Absent/empty → the default profile (`undefined`); else must match {@link PROFILE_NAME_PATTERN}.
 * Throws so an invalid name aborts boot instead of silently landing in the default universe. */
export function parseProfileName(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!PROFILE_NAME_PATTERN.test(raw)) {
    throw new TypeError(
      `invalid profile name ${JSON.stringify(raw)}: expected ${PROFILE_NAME_PATTERN.source}`,
    );
  }
  return raw;
}

/** The daemon state directory name under the user's home: `.linkcode`, or a profile sibling.
 * Validates its input so no caller can interpolate a traversal or separator — safety lives here. */
export function linkcodeStateDirName(profile?: string): string {
  const parsed = parseProfileName(profile);
  return parsed === undefined ? '.linkcode' : `.linkcode-${parsed}`;
}

/** Runtime discovery file the daemon writes after binding, as path segments under the user's home directory. */
export function daemonRuntimeFileSegments(profile?: string): readonly [string, string] {
  return [linkcodeStateDirName(profile), 'runtime.json'];
}

/** Exit code of a daemon that stood down because a live daemon already serves this profile (see
 * apps/daemon/src/runtime.ts). Supervisors treat it as "someone else is serving", not a crash. */
export const DAEMON_EXIT_ALREADY_RUNNING = 3;
