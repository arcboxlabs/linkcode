/**
 * @linkcode/transport —— 通信协议层（PLAN §4.4）。
 * 本地（LocalTransport）与远程（WsTransport）共用同一套 Transport 抽象与 WireMessage 格式。
 */
export * from './transport';
export * from './local';
export * from './ws';
