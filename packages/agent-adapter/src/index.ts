/**
 * @linkcode/agent-adapter — the agent adapter layer + abstraction layer
 * (docs/ARCHITECTURE.md#packages--repo-layout, #key-contracts).
 *
 * Native adapters drive each agent (claude-code / codex / opencode / pi / grok-build) and normalize their
 * events into the zod `AgentEvent` contract. Driven by `@linkcode/engine` but standalone so the adapter
 * set can evolve and be tested independently.
 */

export * from './adapter';
export * from './base';
export { asHistoryId, boundedLimit, cursorOffset } from './history-util';
export * from './login';
export { ClaudeCodeAdapter } from './native/claude-code';
export { CodexAdapter } from './native/codex';
export { GrokBuildAdapter } from './native/grok-build';
export { OpenCodeAdapter } from './native/opencode';
export { PiAdapter } from './native/pi';
export * from './probe';
export * from './registry';
export * from './util';
