import { z } from 'zod';
import { TimestampSchema } from './primitives';

/**
 * Daemon runtime discovery contract: how local clients find the running daemon and tell it apart
 * from a foreign process squatting on the port. The daemon serves its identity at `GET /linkcode`
 * on every listener and advertises its bound endpoints in a runtime file under the user's home.
 */

export {
  DAEMON_DEFAULT_PORT,
  DAEMON_DEFAULT_URL,
  DAEMON_EXIT_ALREADY_RUNNING,
  DAEMON_PORT_HUNT_SPAN,
  daemonBasePort,
  daemonDefaultUrl,
  daemonRuntimeFileSegments,
  keyringServiceName,
  linkcodeStateDirName,
  PROFILE_NAME_PATTERN,
  type ProductChannel,
  parseProductChannel,
  parseProfileName,
} from '../daemon-runtime';

import { PROFILE_NAME_PATTERN } from '../daemon-runtime';
import { PRODUCT_CHANNELS } from '../product';

/** HTTP path every daemon listener answers with its `DaemonIdentity`. */
export const DAEMON_IDENTITY_PATH = '/linkcode';

/** Served at `GET /linkcode`; proves a port is held by a linkcode daemon (and which one). */
export const DaemonIdentitySchema = z.object({
  name: z.literal('linkcode-daemon'),
  pid: z.number().int().positive(),
  startedAt: TimestampSchema,
  /** The daemon's profile; absent means the default profile (pre-profile daemons included). */
  profile: z.string().regex(PROFILE_NAME_PATTERN).optional(),
  /** The `WIRE_PROTOCOL_VERSION` this daemon speaks, so a client can diagnose a lockstep mismatch
   * before dialing instead of reading it as "daemon unavailable". Optional for the same reason
   * `profile` is: a daemon predating this field must still parse, or the singleton probe would
   * mistake it for absent and start a second daemon. */
  wireProtocolVersion: z.number().int().positive().optional(),
  /** The daemon's channel; absent means `release` — every pre-CODE-460 daemon predates the split
   * and served the universe that is now release's alone. Together with `profile` this identifies
   * the state universe, which is what the port hunt compares to tell a double-start from a neighbor.
   * Note this field cannot protect against a daemon that predates it: an older peer's schema
   * silently strips it (zod objects strip unknown keys), which is why the channels also occupy
   * disjoint port ranges — see `daemonBasePort` in `daemon-runtime.ts`. */
  channel: z.enum(PRODUCT_CHANNELS).optional(),
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
