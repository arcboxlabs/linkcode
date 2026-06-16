/**
 * @linkcode/host —— 本地核心：agent 适配层 + 抽象层（PLAN §4.1）。
 */
export * from './agent/adapter';
export * from './agent/registry';
export { ClaudeCodeAdapter } from './agent/claude-code';
export { CodexAdapter } from './agent/codex';
export { OpenCodeAdapter } from './agent/opencode';
export { PiAdapter } from './agent/pi';
export * from './host';
