/**
 * @linkcode/schema — the single source of truth for data contracts
 * (docs/ARCHITECTURE.md#core-principles, #packages--repo-layout).
 * All business message types — cross-process, cross-endpoint, and downstream of the host abstraction layer — originate here.
 * Other packages must not redefine message types; they may only import from here or derive them via z.infer.
 *
 * The agent data vocabulary (content / tool-call / plan / permission / session) is tailored to the four
 * supported agents (claude-code / codex / opencode / pi) and the front-end, not to any wire protocol.
 */

export * from './agent';
export * from './common';
export * from './content';
export * from './daemon-runtime';
export * from './git';
export * from './history';
export * from './permission';
export * from './plan';
export * from './provider-config';
export * from './session';
export * from './terminal';
export * from './tool-call';
export * from './usage';
export * from './wire';
export * from './workspace';
