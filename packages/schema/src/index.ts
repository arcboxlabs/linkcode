/**
 * @linkcode/schema — the single source of truth for data contracts (PLAN §2.1 / §4.3).
 * All business message types — cross-process, cross-endpoint, and downstream of the host abstraction layer — originate here.
 * Other packages must not redefine message types; they may only import from here or derive them via z.infer.
 */
export * from './common';
export * from './agent';
export * from './wire';
