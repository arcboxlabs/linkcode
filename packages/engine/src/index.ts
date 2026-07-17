/**
 * @linkcode/engine — the local core engine (docs/ARCHITECTURE.md#packages--repo-layout): the
 * "host" that runs the agents. `@linkcode/agent-adapter` is re-exported for a single import surface.
 */
export * from '@linkcode/agent-adapter';
export * from './artifacts/host-service';
export * from './automation';
export * from './engine';
export * from './file-service';
export * from './git/git-service';
export type * from './git/provider';
export * from './history-service';
export * from './provider-config';
export type * from './pty-backend';
export * from './scripts/config';
export * from './scripts/hostname';
export * from './scripts/route-registry';
export * from './scripts/script-service';
export * from './session-store';
export * from './terminal-service';
export * from './translator';
export * from './workspace-registry';
export * from './workspace-store';
