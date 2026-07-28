import type { AgentKind, EffortLevel } from '@linkcode/schema';
import type { ModelOption } from './agent-models';

export interface EffortOption {
  id: EffortLevel;
  label: string;
  shortLabel: string;
}

/** Labels for every normalized effort value, independent of which adapter currently offers it.
 * A provider-reflected value can therefore remain truthful even when it is not selectable there. */
export const EFFORT_OPTIONS_BY_ID: Readonly<Record<EffortLevel, EffortOption>> = {
  low: { id: 'low', label: 'Low', shortLabel: 'L' },
  medium: { id: 'medium', label: 'Medium', shortLabel: 'M' },
  high: { id: 'high', label: 'High', shortLabel: 'H' },
  xhigh: { id: 'xhigh', label: 'xHigh', shortLabel: 'xH' },
  max: { id: 'max', label: 'Max', shortLabel: 'Max' },
  ultracode: { id: 'ultracode', label: 'Ultracode', shortLabel: 'UC' },
};

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
    EFFORT_OPTIONS_BY_ID.low,
    EFFORT_OPTIONS_BY_ID.medium,
    EFFORT_OPTIONS_BY_ID.high,
    EFFORT_OPTIONS_BY_ID.xhigh,
    EFFORT_OPTIONS_BY_ID.max,
    EFFORT_OPTIONS_BY_ID.ultracode,
  ],
  codex: [
    EFFORT_OPTIONS_BY_ID.low,
    EFFORT_OPTIONS_BY_ID.medium,
    EFFORT_OPTIONS_BY_ID.high,
    EFFORT_OPTIONS_BY_ID.xhigh,
  ],
  pi: [
    EFFORT_OPTIONS_BY_ID.low,
    EFFORT_OPTIONS_BY_ID.medium,
    EFFORT_OPTIONS_BY_ID.high,
    EFFORT_OPTIONS_BY_ID.xhigh,
  ],
  // Grok Build headless: `--reasoning-effort` high|medium|low (verified 0.2.102).
  'grok-build': [EFFORT_OPTIONS_BY_ID.low, EFFORT_OPTIONS_BY_ID.medium, EFFORT_OPTIONS_BY_ID.high],
};

export function effortOptionsForModel(
  kind: AgentKind | undefined,
  model: ModelOption | undefined,
): EffortOption[] | undefined {
  const options = kind ? AGENT_EFFORT_OPTIONS[kind] : undefined;
  if (!options || model?.effortLevels === undefined) return options;
  const supported = new Set<EffortLevel>(model.effortLevels);
  return options.filter((option) => supported.has(option.id));
}
