import type { AgentKind, EffortLevel } from '@linkcode/schema';

export interface EffortOption {
  id: EffortLevel;
  label: string;
}

/**
 * Reasoning-effort choices, keyed by adapter — same discipline as `AGENT_MODEL_OPTIONS`: only
 * adapters with a working live effort switch get an entry.
 *
 * claude-code switches via the SDK's flag-settings control channel
 * (`Query#applyFlagSettings({ effortLevel })`, streaming-input-mode-only) — the same layer the CLI's
 * `/effort` command writes; there is no dedicated `setEffort()`. `max` is absent because that channel
 * only accepts low|medium|high|xhigh (mirrored by the schema's `EffortLevelSchema`).
 */
export const AGENT_EFFORT_OPTIONS: Partial<Record<AgentKind, EffortOption[]>> = {
  'claude-code': [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'xHigh' },
  ],
};
