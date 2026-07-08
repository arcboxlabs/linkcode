import type { AgentKind } from '@linkcode/schema';

export interface ModelOption {
  id: string;
  label: string;
}

/**
 * Resolve a reflected model id (from `model-update`) to its catalog entry. The daemon emits the
 * *served* id, which for some aliases is a pinned snapshot — e.g. `claude-haiku-4-5` is served as
 * `claude-haiku-4-5-20251001` — so an exact lookup would miss and the picker would fall back to the
 * placeholder. Match a snapshot back to its alias by prefix, but only after an exact match fails, so
 * an id that is itself a prefix of another (`gpt-5.4` vs `gpt-5.4-mini`) never mis-resolves.
 */
export function resolveModel(
  options: readonly ModelOption[] | undefined,
  id: string | null,
): ModelOption | undefined {
  if (id === null) return undefined;
  return (
    options?.find((option) => option.id === id) ??
    options?.find((option) => id.startsWith(`${option.id}-`))
  );
}

/**
 * Curated model choices, keyed by adapter — only for adapters with a *verified* live model switch
 * (`BaseAgentAdapter#onSetModel` actually changing the vendor's behavior end-to-end against a real
 * session, not just read from source — claude-code's first attempt looked live-switchable from its
 * source but a live test proved the single-message + `resume` design silently ignored the override).
 *
 * claude-code was moved to a streaming-input `Query` (one persistent session, `Query#setModel()`
 * for mid-session switches) specifically to fix that. This list intentionally includes legacy models
 * alongside current ones — the choice belongs to the user — but every entry below was individually
 * confirmed by reading the actual served model back off the live message stream after switching:
 *
 *   claude-fable-5     current Fable (Mythos-class tier above Opus; verified 2026-07-08 — served
 *                      model read back as claude-fable-5). Accounts WITHOUT Fable access get a hard
 *                      CLI error ("Claude Fable 5 is currently unavailable"); that surfaces in the
 *                      error banner and the picker keeps the previous model (confirm-then-reflect),
 *                      so offering it to everyone is safe.
 *   claude-opus-4-8    current Opus
 *   claude-opus-4-7    legacy, switches correctly
 *   claude-opus-4-6    legacy, switches correctly
 *   claude-sonnet-5    current Sonnet
 *   claude-sonnet-4-6  legacy ("Previous Sonnet version" in the CLI's own /model menu), switches correctly
 *   claude-haiku-4-5   current Haiku (resolves to the pinned claude-haiku-4-5-20251001 snapshot)
 *
 * One model from the CLI's own registry is deliberately left out because it demonstrably doesn't
 * work as requested, not because of a guess:
 *   - claude-opus-4-1: setModel() accepts it with no error, but the model actually served afterward
 *     (read back from the live stream) was claude-opus-4-8 — a silent substitution, not a real switch.
 *
 * Keeping this table static (instead of reading the CLI's catalog via Query#supportedModels) is a
 * deliberate CODE-104 decision — models change rarely, so refresh it by hand under the discipline
 * above; the dynamic reference implementation lives in closed PR #52.
 *
 * codex entries are the app-server's own `model/list` catalog (ids and display names verbatim).
 * Switching rides the next `turn/start`'s `model` override — applies from the next turn, not
 * mid-turn. Each entry was verified against a live session by switching per turn and reading the
 * model codex actually requested back from the rollout's `turn_context` rows.
 *
 * opencode and pi have no entry here — see their adapters' comments for why.
 */
export const AGENT_MODEL_OPTIONS: Partial<Record<AgentKind, ModelOption[]>> = {
  'claude-code': [
    { id: 'claude-fable-5', label: 'Fable 5' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7 (Legacy)' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6 (Legacy)' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (Legacy)' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
  codex: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  ],
};
