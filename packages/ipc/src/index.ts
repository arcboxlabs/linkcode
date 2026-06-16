/**
 * @linkcode/ipc —— TypeSafe IPC 抽象 + tRPC 默认实现（PLAN §4.5）。仅 desktop 使用。
 * 不依赖 electron：承载由调用方注入；不承载任何业务数据。
 */
export * from './context';
export * from './bridge';
export * from './router';
export * from './link';
