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
 *
 * codex supports exactly these four levels (its `model/list` advertises low–xhigh for every
 * model; `minimal` exists in codex config but not in our EffortLevel vocabulary, and
 * `max`/`ultracode` are claude-only concepts the codex adapter rejects). Switching rides the
 * next `turn/start`'s `effort` override — applies from the next turn, not mid-turn. Verified
 * live per level by reading `collaboration_mode.settings.reasoning_effort` back from the
 * rollout's `turn_context` rows.
 *
 * pi maps these four onto its in-process `setThinkingLevel` (a synchronous live switch, applies
 * from the next turn; verified via SDK readback on 0.80.6). pi's extra `off`/`minimal` levels
 * have no EffortLevel representation and stay unreachable from this picker; the adapter reflects
 * the SDK's clamp readback when a model supports fewer levels.
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
  // Grok Build headless: `--reasoning-effort` high|medium|low (verified 0.2.102).
  'grok-build': [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ],
  pi: [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'xHigh' },
  ],
};
