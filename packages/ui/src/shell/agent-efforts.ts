import type { AgentKind, EffortLevel } from '@linkcode/schema';

export interface EffortOption {
  id: EffortLevel;
  label: string;
}

/**
 * Reasoning-effort choices, keyed by adapter — same discipline as `AGENT_MODEL_OPTIONS`: only
 * adapters with a working effort switch get an entry.
 *
 * claude-code switches low–xhigh and ultracode live via the SDK's flag-settings control channel
 * (`Query#applyFlagSettings`, streaming-input-mode-only) — the same layer the CLI's `/effort`
 * command writes. `max` can't travel that channel, so the adapter restarts the underlying process
 * with `--effort max` and resumes the conversation in place (same for leaving `max`, since the
 * startup flag outranks later flag-settings switches). `ultracode` needs dynamic workflows enabled
 * in the user's Claude config; picking it with workflows off is rejected and the selector keeps
 * the previous level.
 *
 * codex supports exactly these four levels (its `model/list` advertises low–xhigh for every
 * model; `minimal` exists in codex config but not in our EffortLevel vocabulary, and
 * `max`/`ultracode` are claude-only concepts the codex adapter rejects). Switching rides the
 * next `turn/start`'s `effort` override — applies from the next turn, not mid-turn. Verified
 * live per level by reading `collaboration_mode.settings.reasoning_effort` back from the
 * rollout's `turn_context` rows.
 */
export const AGENT_EFFORT_OPTIONS: Partial<Record<AgentKind, EffortOption[]>> = {
  'claude-code': [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'xHigh' },
    { id: 'max', label: 'Max' },
    { id: 'ultracode', label: 'Ultracode' },
  ],
  codex: [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'xHigh' },
  ],
};
