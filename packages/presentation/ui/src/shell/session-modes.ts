import type { SessionMode } from '@linkcode/schema';

/**
 * Workflow modes — provider-advertised `SessionMode`s, at most one active (`currentModeId`);
 * switching sends `set-mode` and the active mode reflects back via `current-mode-update`.
 * This axis is HOW the agent works, NOT the approval policy (the separate permission/safety axis
 * — `ApprovalPolicyState` in @linkcode/schema). Approval-policy ids (default / acceptEdits /
 * auto / bypassPermissions) stay off this channel even once real modes are advertised.
 * TODO(backend): `SessionModeState.availableModes` is not emitted yet — until then the composer
 * menu shows the stub rows below; delete `STUB_SESSION_MODES` once agents advertise real modes.
 */

// TODO(backend): replace with the agent-advertised mode list from `SessionModeState`.
// TODO(modes): prevent hardcoded workflow modes once agents reliably advertise capabilities.
// TODO(i18n): move stub labels/descriptions into i18n after the command-menu copy settles.
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
