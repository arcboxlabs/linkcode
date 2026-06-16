/**
 * @linkcode/host — the local core: agent adapter layer + abstraction layer (PLAN §4.1).
 */
export * from './agent/adapter';
export * from './agent/registry';
export { ClaudeCodeAdapter } from './agent/claude-code';
export { CodexAdapter } from './agent/codex';
export { OpenCodeAdapter } from './agent/opencode';
export { PiAdapter } from './agent/pi';
export * from './host';
