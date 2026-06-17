/**
 * @linkcode/agent-adapter — the agent adapter layer + abstraction layer (PLAN §4.2 / §6).
 *
 * One adapter per coding agent (claude-code / codex / opencode / pi), each normalizing the SDK's native
 * messages into the zod `AgentEvent` contract. Hosted by `@linkcode/host`, but kept as a standalone package
 * so the adapter set can evolve (and be tested) independently of the orchestration engine.
 */
export * from './adapter';
export * from './registry';
export { ClaudeCodeAdapter } from './claude-code';
export { CodexAdapter } from './codex';
export { OpenCodeAdapter } from './opencode';
export { PiAdapter } from './pi';
