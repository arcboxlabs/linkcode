import { z } from 'zod';
import { TimestampSchema } from './common';

/**
 * Daemon runtime discovery contract: how local clients (desktop main, a second daemon instance,
 * a future CLI) find the running daemon and tell it apart from a foreign process squatting on
 * the port. The daemon serves its identity at `GET /linkcode` on every listener and advertises
 * its bound endpoints in a runtime file under the user's home directory.
 */

/** Default TCP port of the local daemon: 0x4C43 — ascii "LC". */
export const DAEMON_DEFAULT_PORT = 19523;
export const DAEMON_DEFAULT_URL = `http://127.0.0.1:${DAEMON_DEFAULT_PORT}`;

/** HTTP path every daemon listener answers with its `DaemonIdentity`. */
export const DAEMON_IDENTITY_PATH = '/linkcode';

/** Runtime discovery file the daemon writes after binding, as path segments under the user's home directory. */
export const DAEMON_RUNTIME_FILE_SEGMENTS = ['.linkcode', 'runtime.json'] as const;

/** Served at `GET /linkcode`; proves a port is held by a linkcode daemon (and which one). */
export const DaemonIdentitySchema = z.object({
  name: z.literal('linkcode-daemon'),
  pid: z.number().int().positive(),
  startedAt: TimestampSchema,
});
export type DaemonIdentity = z.infer<typeof DaemonIdentitySchema>;

/** One bound listener endpoint, as the URL a local client should dial. */
export const DaemonListenerInfoSchema = z.object({
  type: z.enum(['socket.io', 'ws']),
  url: z.url(),
});
export type DaemonListenerInfo = z.infer<typeof DaemonListenerInfoSchema>;

/** Contents of the runtime discovery file: identity plus the actually-bound endpoints. */
export const DaemonRuntimeInfoSchema = DaemonIdentitySchema.extend({
  listeners: z.array(DaemonListenerInfoSchema).min(1),
});
export type DaemonRuntimeInfo = z.infer<typeof DaemonRuntimeInfoSchema>;
