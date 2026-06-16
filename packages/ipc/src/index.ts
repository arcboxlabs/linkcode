/**
 * @linkcode/ipc — the TypeSafe IPC abstraction + default tRPC implementation (PLAN §4.5). Used by desktop only.
 * Does not depend on electron: the carrier is injected by the caller; carries no business data.
 */
export * from './context';
export * from './bridge';
export * from './router';
export * from './link';
