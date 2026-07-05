/**
 * @linkcode/transport — the communication protocol layer (docs/ARCHITECTURE.md#packages--repo-layout).
 * Local, WebSocket, and Socket.IO implementations share the same Transport abstraction and WireMessage format.
 */

// The tunnel wire contract and client live in the published SDK; re-exported
// so consumers keep a single transport entry point.
export * from '@linkcode/tunnel';
export * from './local';
export * from './preview-routes';
export * from './socket-io';
export * from './transport';
export * from './tunnel';
export * from './ws';
