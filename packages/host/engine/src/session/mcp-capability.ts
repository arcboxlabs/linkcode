import type { AgentKind } from '@linkcode/schema';

/**
 * Agent kinds whose SDKs accept MCP server configuration. pi runs in-process with no MCP support
 * at all, and grok-build's headless CLI exposes none — the engine never injects for those, and
 * their adapters loudly reject explicit `mcpServers` rather than silently dropping them.
 */
export const MCP_CAPABLE_AGENT_KINDS: ReadonlySet<AgentKind> = new Set([
  'claude-code',
  'codex',
  'opencode',
]);

/** The daemon's built-in simulator MCP endpoint name — shared by the daemon endpoint host, the
 * session resolver's injection, and custom-MCP reserved-name validation. */
export const SIMULATOR_MCP_SERVER_NAME = 'linkcode-sim';
