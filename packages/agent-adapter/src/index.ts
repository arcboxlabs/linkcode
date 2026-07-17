/**
 * @linkcode/agent-adapter — the agent adapter + abstraction layer
 * (docs/ARCHITECTURE.md#packages--repo-layout, #key-contracts). Native adapters drive each agent's
 * real SDK and normalize events into the zod `AgentEvent` contract; standalone from
 * `@linkcode/engine` so the adapter set evolves and is tested independently.
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
