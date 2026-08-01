import type { McpServer, SessionId } from '@linkcode/schema';

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
