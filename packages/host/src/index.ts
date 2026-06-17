/**
 * @linkcode/host — the local core engine (PLAN §4.1).
 *
 * Manages agent sessions and routes normalized events between the agent adapters (`@linkcode/agent-adapter`) and
 * the client over a transport. The adapter layer lives in its own package; re-exported here for
 * convenience so callers can reach both from a single import surface.
 */
export * from '@linkcode/agent-adapter';
export * from './host';
