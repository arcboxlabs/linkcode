import type { AgentKind, McpServer, SessionId } from '@linkcode/schema';

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

/**
 * Daemon-owned provider of the per-session simulator MCP endpoint (CODE-395). The daemon mints a
 * loopback URL with a session-bound token, so every tool call lands in the engine's
 * {@link ../simulator/service!SimulatorService} under the right session — ownership and caps
 * apply to agents exactly as they do to wire clients.
 */
export interface SimulatorMcpProvider {
  /** The MCP server entry to inject into a session's start options, or undefined when the
   * simulator capability is absent on this host. */
  endpointFor(sessionId: SessionId): McpServer | undefined;
  /** Forget a session's endpoint token (called when the session stops). */
  release(sessionId: SessionId): void;
}
