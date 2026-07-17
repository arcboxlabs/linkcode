/** @linkcode/transport — the communication protocol layer (docs/ARCHITECTURE.md#packages--repo-layout):
 * local, WebSocket, and Socket.IO implementations share one Transport abstraction and WireMessage format. */

export type { HostInfo, TunnelRole } from '@linkcode/tunnel';
export {
  HOST_ID_PATTERN,
  HOST_NAME_MAX_LENGTH,
  TUNNEL_CHUNK_HEADER_BYTES,
  TUNNEL_CHUNK_PAYLOAD_BYTES,
  TUNNEL_CHUNK_VERSION,
  TUNNEL_MAX_CONNECTION_AGE_MS,
  TUNNEL_MAX_FRAME_BYTES,
  TUNNEL_PATH,
  TUNNEL_PING_FRAME,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PONG_FRAME,
  TUNNEL_ROLES,
  TunnelChunkAssembler,
  TunnelChunkEncoder,
  TunnelCloseCode,
} from '@linkcode/tunnel';
export * from './local';
export * from './preview-routes';
export * from './socket-io';
export * from './transport';
export * from './tunnel';
export * from './tunnel-client';
export * from './tunnel-peer-frame';
export * from './tunnel-protocol';
export * from './ws';
