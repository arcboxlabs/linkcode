import type { AgentKind, EffortLevel } from '@linkcode/schema';

export interface EffortOption {
  id: EffortLevel;
  label: string;
}

/**
 * Reasoning-effort choices, keyed by adapter — only adapters with a *verified* working effort
 * switch get an entry. Unlike models (each agent's own catalog, served via `agent-model.list`),
 * efforts stay a static table until per-model effort advertising lands (CODE-104's codex task).
 *
 * claude-code switches low–xhigh and ultracode live via the SDK's flag-settings control channel
 * (`Query#applyFlagSettings`, streaming-input-mode-only) — the same layer the CLI's `/effort`
 * command writes. `max` can't travel that channel, so the adapter restarts the underlying process
 * with `--effort max` and resumes the conversation in place (same for leaving `max`, since the
 * startup flag outranks later flag-settings switches). `ultracode` needs dynamic workflows enabled
 * in the user's Claude config; picking it with workflows off is rejected and the selector keeps
 * the previous level.
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
};
