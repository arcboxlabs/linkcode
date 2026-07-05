import type { SessionMode } from '@linkcode/schema';

/**
 * Workflow modes — provider-specific behaviors the agent advertises as `SessionMode`s (claude-code
 * has plan, codex has plan and goal, …) with at most one active at a time (`currentModeId`). They
 * ride the existing wire: switching sends the `set-mode` input and the active mode reflects back
 * via the `current-mode-update` event.
 *
 * This axis is about HOW the agent works (propose a plan first / drive toward a goal); it is NOT
 * the approval policy, which is the separate permission/safety axis — see approval-policy.ts.
 *
 * TODO(backend): the advertised mode list (`SessionModeState.availableModes`) is not emitted to
 * clients yet — only `current-mode-update` is. Until then, the composer command menu shows the
 * frontend-only stub rows below. Once agents provide real names/descriptions, delete
 * `STUB_SESSION_MODES` and keep approval-policy-flavored ids (default / acceptEdits /
 * bypassPermissions) off this channel; adapters map them onto the policy concept instead.
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
