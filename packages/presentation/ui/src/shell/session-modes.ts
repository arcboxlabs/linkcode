import type { SessionMode } from '@linkcode/schema';

// TODO(backend): replace with agent-advertised modes; move labels to i18n after copy settles.
export const STUB_SESSION_MODES: SessionMode[] = [
  {
    modeId: 'plan',
    name: 'Plan',
    description: 'Research and propose changes',
  },
  {
    modeId: 'goal',
    name: 'Goal',
    description: 'Keep working toward a goal',
  },
];

/** Toggling the active mode off targets the agent's normal mode. TODO(backend): confirm how the
 * contract represents "no special mode"; agents conventionally advertise it as `default`. */
export const DEFAULT_MODE_ID = 'default';
