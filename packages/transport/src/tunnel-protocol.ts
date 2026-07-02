/**
 * The HQ tunnel wire contract.
 *
 * Vendored from linkcodehq `packages/tunnel` (protocol.ts) until
 * `@linkcodehq/tunnel` ships on npm; the dependency then replaces this file.
 * Do not diverge from the upstream copy.
 */

export const TUNNEL_PATH = '/tunnel';

/**
 * The wire-contract version, negotiated as a WebSocket subprotocol: clients
 * offer it on the handshake, the server echoes it on accept. Breaking
 * protocol changes ship as `…tunnel.v2` and negotiate here instead of
 * inventing a new path.
 */
export const TUNNEL_SUBPROTOCOL = 'linkcode.tunnel.v1';

export const TUNNEL_ROLES = ['host', 'client'] as const;
export type TunnelRole = (typeof TUNNEL_ROLES)[number];

/**
 * Close codes surfaced to tunnel peers. 4000–4999 are application-defined;
 * where a natural HTTP analogue exists the last digits mirror it.
 */
export const TunnelCloseCode = {
  BadHandshake: 4000,
  /** A newer connection for the same host id took over. */
  Replaced: 4001,
  /** The host this client was attached to disconnected. */
  HostGone: 4002,
  /** The host the client asked for is not connected (↔ HTTP 404). */
  HostNotFound: 4004,
  /** No ping received for too long; presumed dead (↔ HTTP 408). */
  StaleConnection: 4008,
  /** Connection outlived its handshake credential — reconnect with a fresh JWT (↔ HTTP 401). */
  ReauthRequired: 4011,
  /** Per-user host or per-host client quota exceeded (↔ HTTP 429). */
  TooManyConnections: 4029,
} as const;

export type TunnelCloseCode = (typeof TunnelCloseCode)[keyof typeof TunnelCloseCode];

/**
 * Liveness contract: every peer sends the text frame {@link TUNNEL_PING_FRAME}
 * at least once per {@link TUNNEL_PING_INTERVAL_MS}; the relay answers
 * {@link TUNNEL_PONG_FRAME} without waking (WebSocket auto-response) and
 * closes connections that stay silent for ~3 intervals with
 * {@link TunnelCloseCode.StaleConnection}. Both text frames are reserved —
 * the relay never forwards them, which is why data travels as binary chunk
 * frames (see tunnel-chunk.ts) rather than text.
 */
export const TUNNEL_PING_FRAME = 'ping';
export const TUNNEL_PONG_FRAME = 'pong';
export const TUNNEL_PING_INTERVAL_MS = 30000;

/**
 * The relay evicts connections older than this with
 * {@link TunnelCloseCode.ReauthRequired}, bounding how long a revoked
 * credential can keep an established tunnel alive. Hosts rotate onto a fresh
 * socket ahead of the cutoff (the relay hands attached clients over to the
 * successor), so clients never observe it.
 */
export const TUNNEL_MAX_CONNECTION_AGE_MS = 24 * 60 * 60 * 1000;

/** workerd caps a WebSocket message at 1 MiB; every frame crossing the tunnel must stay below it. */
export const TUNNEL_MAX_FRAME_BYTES = 1024 * 1024;

/** Host ids are server-issued stable identifiers — the host device's registered id. */
export const HOST_ID_PATTERN = /^[\w.-]{1,64}$/;
export const HOST_NAME_MAX_LENGTH = 128;

/** What the discovery endpoint (`GET /tunnel/hosts`) reports for each online host. */
export interface HostInfo {
  readonly hostId: string;
  readonly name: string | null;
  readonly connectedAt: number;
  /** Last liveness signal (ping) or `connectedAt` if the host never pinged. */
  readonly lastSeen: number;
}
