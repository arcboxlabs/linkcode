/**
 * @linkcode/schema — the single source of truth for data contracts
 * (docs/ARCHITECTURE.md#core-principles): other packages never redefine message types, only
 * import or z.infer them. The agent vocabulary is tailored to the five supported agents and the
 * front-end, not to any wire protocol.
 */

export * from './model';
export * from './wire';
