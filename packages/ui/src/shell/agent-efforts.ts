import type { AgentKind, EffortLevel } from '@linkcode/schema';

export interface EffortOption {
  id: EffortLevel;
  label: string;
}

/**
 * Reasoning-effort choices, keyed by adapter — same discipline as `AGENT_MODEL_OPTIONS`: only
 * adapters with a verified live effort switch get an entry.
 * claude-code: `max` can't ride the live flag-settings channel, so the adapter restarts the
 * process and resumes in place (entering and leaving — the startup flag outranks flag-settings);
 * `ultracode` needs dynamic workflows enabled, else the pick is rejected and the selector keeps
 * the previous level.
 * codex: exactly these four (`minimal` isn't in our EffortLevel vocabulary; `max`/`ultracode` are
 * claude-only and rejected); switches apply from the next turn, not mid-turn.
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
