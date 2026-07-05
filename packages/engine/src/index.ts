/**
 * @linkcode/engine — the local core engine (docs/ARCHITECTURE.md#packages--repo-layout): the "host"
 * that runs the agents.
 *
 * Manages agent sessions and routes normalized events between the agent adapters (`@linkcode/agent-adapter`) and
 * the client over a transport. The adapter layer lives in its own package; re-exported here for
 * convenience so callers can reach both from a single import surface.
 */
export * from '@linkcode/agent-adapter';
export * from './engine';
export * from './file-service';
export * from './git/git-service';
export type * from './git/provider';
export * from './history-service';
export * from './provider-config';
export type * from './pty-backend';
export * from './session-store';
export * from './terminal-service';
export * from './workspace-registry';
export * from './workspace-store';
