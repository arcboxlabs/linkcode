import type { AgentKind, EffortLevel } from '@linkcode/schema';

export interface EffortOption {
  id: EffortLevel;
  label: string;
  shortLabel: string;
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
    { id: 'low', label: 'Low', shortLabel: 'L' },
    { id: 'medium', label: 'Medium', shortLabel: 'M' },
    { id: 'high', label: 'High', shortLabel: 'H' },
    { id: 'xhigh', label: 'xHigh', shortLabel: 'xH' },
    { id: 'max', label: 'Max', shortLabel: 'Max' },
    { id: 'ultracode', label: 'Ultracode', shortLabel: 'UC' },
  ],
  codex: [
    { id: 'low', label: 'Low', shortLabel: 'L' },
    { id: 'medium', label: 'Medium', shortLabel: 'M' },
    { id: 'high', label: 'High', shortLabel: 'H' },
    { id: 'xhigh', label: 'xHigh', shortLabel: 'xH' },
  ],
  // Grok Build headless: `--reasoning-effort` high|medium|low (verified 0.2.102).
  'grok-build': [
    { id: 'low', label: 'Low', shortLabel: 'L' },
    { id: 'medium', label: 'Medium', shortLabel: 'M' },
    { id: 'high', label: 'High', shortLabel: 'H' },
  ],
};
