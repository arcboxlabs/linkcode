import type { AgentKind, EffortLevel } from '@linkcode/schema';

export interface EffortOption {
  id: EffortLevel;
  label: string;
}

/**
 * Reasoning-effort choices, keyed by adapter — same discipline as `AGENT_MODEL_OPTIONS`: only
 * adapters with a working effort switch get an entry.
 *
 * claude-code switches low–xhigh live via the SDK's flag-settings control channel
 * (`Query#applyFlagSettings({ effortLevel })`, streaming-input-mode-only) — the same layer the
 * CLI's `/effort` command writes. `max` can't travel that channel, so the adapter restarts the
 * underlying process with `--effort max` and resumes the conversation in place (same for leaving
 * `max`, since the startup flag outranks later flag-settings switches).
 */
export const AGENT_EFFORT_OPTIONS: Partial<Record<AgentKind, EffortOption[]>> = {
  'claude-code': [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'xHigh' },
    { id: 'max', label: 'Max' },
  ],
};
