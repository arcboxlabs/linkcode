/** Zero-dependency half of the daemon discovery contract (see `model/daemon-discovery.ts`);
 * kept zod-free so the sandboxed Electron preload (no `require('zod')`) can import it. */
import type { ProductChannel } from './product';
import { dataDirName, stateDirBasename } from './product';

export type { ProductChannel } from './product';
export { parseProductChannel } from './product';

/** Default TCP port of the local daemon: 0x4C43 — ascii "LC". This is the release channel's base;
 * `daemonBasePort` is what a daemon actually starts hunting from. */
export const DAEMON_DEFAULT_PORT = 19523;
export const DAEMON_DEFAULT_URL = `http://127.0.0.1:${DAEMON_DEFAULT_PORT}`;

/** How many ports one channel may hunt through before giving up. */
export const DAEMON_PORT_HUNT_SPAN = 10;

/**
 * Where a channel starts hunting. The ranges are disjoint (release 19523–19532, development
 * 19533–19542) and that is load-bearing, not tidiness: the `channel` field cannot defend against a
 * daemon released before it existed. Such a peer parses a newer identity through a schema without
 * the field, zod strips it, and its `occupant.profile === identity.profile` check then reads two
 * default profiles as equal — so it exits 3 against a development daemon and its supervisor stands
 * down. Never letting the two channels reach the same port removes that misclassification entirely,
 * in the only direction we cannot patch: already-shipped binaries.
 */
export function daemonBasePort(channel: ProductChannel): number {
  return channel === 'development'
    ? DAEMON_DEFAULT_PORT + DAEMON_PORT_HUNT_SPAN
    : DAEMON_DEFAULT_PORT;
}

/** The URL a client falls back to when no `runtime.json` names a live daemon of its channel. */
export function daemonDefaultUrl(channel: ProductChannel): string {
  return `http://127.0.0.1:${daemonBasePort(channel)}`;
}

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

/** The daemon state directory name under the user's home: the channel's base name, or a profile
 * sibling of it. Validates its input so no caller can interpolate a traversal or separator —
 * safety lives here. `channel` is required: defaulting it would let a missed call site silently
 * land a development build in the release universe, which is the whole bug class this prevents. */
export function linkcodeStateDirName(channel: ProductChannel, profile?: string): string {
  const parsed = parseProfileName(profile);
  const base = stateDirBasename(channel);
  return parsed === undefined ? base : `${base}-${parsed}`;
}

/**
 * Service name under which the daemon's secret vault stores its master key in the OS keyring
 * (CODE-371). Forks by channel × profile for the same reason every path does: a development daemon
 * must not be able to read — or overwrite — the release daemon's credentials. Matches the desktop
 * shell's `APP_NAME`, so one keychain group covers the whole universe, and a fork that renames the
 * brand in `product.ts` renames this too.
 */
export function keyringServiceName(channel: ProductChannel, profile?: string): string {
  const parsed = parseProfileName(profile);
  const base = dataDirName(channel);
  return parsed === undefined ? base : `${base} (${parsed})`;
}

/** Runtime discovery file the daemon writes after binding, as path segments under the user's home directory. */
export function daemonRuntimeFileSegments(
  channel: ProductChannel,
  profile?: string,
): readonly [string, string] {
  return [linkcodeStateDirName(channel, profile), 'runtime.json'];
}

/** Exit code of a daemon that stood down because a live daemon already serves this profile (see
 * apps/daemon/src/runtime.ts). Supervisors treat it as "someone else is serving", not a crash. */
export const DAEMON_EXIT_ALREADY_RUNNING = 3;
