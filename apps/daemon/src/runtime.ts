import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isPidAlive, readJsonFileSync } from '@linkcode/common/node';
import type { DaemonIdentity, DaemonRuntimeInfo } from '@linkcode/schema';
import {
  DAEMON_IDENTITY_PATH,
  DaemonIdentitySchema,
  DaemonRuntimeInfoSchema,
} from '@linkcode/schema';
import type { PreviewRouteTable } from '@linkcode/transport';
import type { TransportServer } from '@linkcode/transport/server';
import { createTransportServer } from '@linkcode/transport/server';
import { isErrorLikeObject } from 'foxts/extract-error-message';
import type { DaemonListenerConfig } from './config';
import { runtimeFilePath } from './config';

/**
 * Daemon runtime discovery: bind listeners with port hunting, refuse to double-start
 * (one daemon per profile — they would share that profile's `daemon.db`), and advertise the
 * actually-bound endpoints in the runtime file for local clients (desktop main, cli) to read.
 * Daemons of other profiles are just port neighbors: the hunt skips past them.
 */

const PORT_HUNT_ATTEMPTS = 10;
const PROBE_TIMEOUT_MS = 1000;

/** The configured port is held by a live linkcode daemon — the caller should exit instead of hunting on. */
export class DaemonAlreadyRunningError extends Error {
  constructor(
    readonly identity: DaemonIdentity,
    readonly url: string,
  ) {
    super(`another linkcode daemon (pid ${identity.pid}) is already listening at ${url}`);
    this.name = 'DaemonAlreadyRunningError';
  }
}

/**
 * Ask whoever answers HTTP at `baseUrl` for its `GET /linkcode` identity.
 * `null` — by contract, not as a swallowed error — means "not a linkcode daemon"
 * (connection refused, timeout, non-200, or a body that fails the schema).
 */
export async function probeDaemonIdentity(baseUrl: string): Promise<DaemonIdentity | null> {
  try {
    const res = await fetch(new URL(DAEMON_IDENTITY_PATH, baseUrl), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = DaemonIdentitySchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Bind a listener, hunting upward from the configured port when a foreign process holds it.
 * Throws `DaemonAlreadyRunningError` when the occupant is a live linkcode daemon.
 */
export function listenWithPortHunt(
  listener: DaemonListenerConfig,
  identity: DaemonIdentity,
  previewRoutes?: PreviewRouteTable,
): Promise<{ server: TransportServer; url: string; port: number }> {
  return huntFrom(listener, identity, previewRoutes, 0);
}

// Recursive rather than a loop: each attempt depends on the previous one (bind, probe, next port).
async function huntFrom(
  listener: DaemonListenerConfig,
  identity: DaemonIdentity,
  previewRoutes: PreviewRouteTable | undefined,
  attempt: number,
): Promise<{ server: TransportServer; url: string; port: number }> {
  const port = listener.port + attempt;
  try {
    const server = await createTransportServer({ ...listener, port, identity, previewRoutes });
    return { server, url: listenerUrl(listener.type, listener.host, port), port };
  } catch (err) {
    if (!isAddrInUse(err)) throw err;
    const probeUrl = httpUrl(listener.host, port);
    const occupant = await probeDaemonIdentity(probeUrl);
    // Our own pid means another of this daemon's listeners hunted onto the port — keep going.
    // A daemon of another profile (absent field = default profile) is not a double-start
    // either: profiles are isolated universes, so hunt past it like any foreign process.
    if (occupant && occupant.pid !== identity.pid && occupant.profile === identity.profile) {
      throw new DaemonAlreadyRunningError(occupant, probeUrl);
    }
    if (attempt + 1 >= PORT_HUNT_ATTEMPTS) {
      throw new Error(
        `no free port for ${listener.type} in ${listener.port}–${listener.port + PORT_HUNT_ATTEMPTS - 1}`,
        { cause: err },
      );
    }
    return huntFrom(listener, identity, previewRoutes, attempt + 1);
  }
}

/**
 * The daemon advertised by the runtime file, or `null` when there is none: file missing or
 * malformed (stale leftovers are overwritten on the next successful start), pid dead, or the
 * advertised endpoint no longer answering as a linkcode daemon.
 */
export async function findRunningDaemon(): Promise<DaemonRuntimeInfo | null> {
  const parsed = DaemonRuntimeInfoSchema.safeParse(readJsonFileSync(runtimeFilePath()));
  if (!parsed.success || !isPidAlive(parsed.data.pid)) return null;
  const probeBase = new URL(parsed.data.listeners[0].url);
  probeBase.protocol = probeBase.protocol === 'wss:' ? 'https:' : 'http:';
  const identity = await probeDaemonIdentity(probeBase.href);
  return identity?.pid === parsed.data.pid ? parsed.data : null;
}

/** Written `0600` after every listener is bound; removed again on shutdown. */
export function writeRuntimeFile(info: DaemonRuntimeInfo): void {
  const path = runtimeFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
}

export function removeRuntimeFile(): void {
  rmSync(runtimeFilePath(), { force: true });
}

/** The URL a local client should dial; wildcard binds are advertised as loopback. */
function listenerUrl(
  type: DaemonListenerConfig['type'],
  host: string | undefined,
  port: number,
): string {
  return `${type === 'ws' ? 'ws' : 'http'}://${clientHost(host)}:${port}`;
}

function httpUrl(host: string | undefined, port: number): string {
  return `http://${clientHost(host)}:${port}`;
}

function clientHost(host: string | undefined): string {
  return !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

function isAddrInUse(err: unknown): boolean {
  return isErrorLikeObject(err) && (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
}
