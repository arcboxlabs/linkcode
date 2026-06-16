/**
 * @linkcode/transport — the communication protocol layer (PLAN §4.4).
 * Local (LocalTransport) and remote (WsTransport) share the same Transport abstraction and WireMessage format.
 */
export * from './transport';
export * from './local';
export * from './ws';
