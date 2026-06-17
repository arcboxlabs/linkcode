/**
 * @linkcode/agent-adapter — the agent adapter layer + abstraction layer (PLAN §4.2 / §6).
 *
 * Native adapters drive each agent's real SDK (claude-code / codex / opencode / pi) and normalize their
 * events into the zod `AgentEvent` contract (ACP-aligned). A generic ACP adapter is the seam for the long
 * tail. Driven by `@linkcode/engine` but standalone so the adapter set can evolve and be tested independently.
 */
export * from './adapter';
export * from './base';
export * from './registry';
export * from './util';
export { ClaudeCodeAdapter } from './native/claude-code';
export { CodexAdapter } from './native/codex';
export { OpenCodeAdapter } from './native/opencode';
export { PiAdapter } from './native/pi';
export { AcpAdapter, type AcpAgentSpec, acpUpdateToEvent } from './acp/acp-adapter';
