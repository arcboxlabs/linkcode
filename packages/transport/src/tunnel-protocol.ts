/** Breaking tunnel changes negotiate a new WebSocket subprotocol. */
export const TUNNEL_SUBPROTOCOL = 'linkcode.tunnel.v2';

/** Sent by an open host socket before the relay makes it routable. */
export const TUNNEL_HOST_READY_FRAME = 'host.ready';
/** Relay acknowledgment that the host socket is routable. */
export const TUNNEL_HOST_READY_ACK_FRAME = 'host.ready.ack';
/** Relay acknowledgment that a replacement host is staged behind the active socket. */
export const TUNNEL_HOST_PREPARED_FRAME = 'host.prepared';
/** Candidate registration for a coordinated rotation; suffix is a one-time token. */
export const TUNNEL_HOST_ROTATE_PREFIX = 'host.rotate:';
/** Active-host barrier for that same token; all earlier outbound frames precede it. */
export const TUNNEL_HOST_HANDOFF_PREFIX = 'host.handoff:';
/** Relay acknowledgment that the old host's inbound prefix has been drained. */
export const TUNNEL_HOST_HANDOFF_ACK_FRAME = 'host.handoff.ack';
