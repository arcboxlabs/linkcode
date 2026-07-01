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
 * for mid-session switches) specifically to fix that; `claude-opus-4-8` and `claude-sonnet-4-6` are
 * confirmed working by reading the actual model back off the live message stream after switching.
 * `claude-fable-5` is the third id from the same SDK doc comment, not independently verified.
 *
 * opencode and pi have no entry here — see their adapters' comments for why.
 */
export const AGENT_MODEL_OPTIONS: Partial<Record<AgentKind, ModelOption[]>> = {
  'claude-code': [
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { id: 'claude-fable-5', label: 'Fable 5' },
  ],
};
