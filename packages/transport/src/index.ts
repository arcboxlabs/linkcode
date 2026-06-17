/**
 * @linkcode/transport — the communication protocol layer (PLAN §4.4).
 * Local, WebSocket, and Socket.IO implementations share the same Transport abstraction and WireMessage format.
 */
export * from './transport';
export * from './local';
export * from './ws';
export * from './socket-io';
