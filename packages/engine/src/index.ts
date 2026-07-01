/**
 * @linkcode/engine — the local core engine (PLAN §4.1): the "host" that runs the agents.
 *
 * Manages agent sessions and routes normalized events between the agent adapters (`@linkcode/agent-adapter`) and
 * the client over a transport. The adapter layer lives in its own package; re-exported here for
 * convenience so callers can reach both from a single import surface.
 */
export * from '@linkcode/agent-adapter';
export * from './engine';
export * from './history-service';
export type * from './pty-backend';
export * from './terminal-service';
