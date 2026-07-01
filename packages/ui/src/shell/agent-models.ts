import type { AgentKind } from '@linkcode/schema';

export interface ModelOption {
  id: string;
  label: string;
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
 *   claude-opus-4-8    current Opus
 *   claude-opus-4-7    legacy, switches correctly
 *   claude-opus-4-6    legacy, switches correctly
 *   claude-sonnet-5    current Sonnet
 *   claude-sonnet-4-6  legacy ("Previous Sonnet version" in the CLI's own /model menu), switches correctly
 *   claude-haiku-4-5   current Haiku (resolves to the pinned claude-haiku-4-5-20251001 snapshot)
 *
 * Two models from the CLI's own registry are deliberately left out because they demonstrably don't
 * work as requested, not because of a guess:
 *   - claude-fable-5: the CLI returns a hard error, "Claude Fable 5 is currently unavailable" — this
 *     account has no Fable access.
 *   - claude-opus-4-1: setModel() accepts it with no error, but the model actually served afterward
 *     (read back from the live stream) was claude-opus-4-8 — a silent substitution, not a real switch.
 *
 * opencode and pi have no entry here — see their adapters' comments for why.
 */
export const AGENT_MODEL_OPTIONS: Partial<Record<AgentKind, ModelOption[]>> = {
  'claude-code': [
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7 (Legacy)' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6 (Legacy)' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (Legacy)' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
};
