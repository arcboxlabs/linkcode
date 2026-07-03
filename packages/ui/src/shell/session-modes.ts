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
 * clients yet — only `current-mode-update` is. Emit it (names/descriptions come from the agent,
 * per provider) so `STUB_SESSION_MODES` below can be deleted. Approval-policy-flavored ids
 * (default / acceptEdits / bypassPermissions) must not appear on this channel once the policy
 * axis lands; adapters map them onto the policy concept instead.
 */

// TODO(backend): replace with the agent-advertised mode list from `SessionModeState`.
export const STUB_SESSION_MODES: SessionMode[] = [
  {
    modeId: 'plan',
    name: 'Plan',
    description: 'Research and propose a plan before making changes.',
  },
  {
    modeId: 'goal',
    name: 'Goal',
    description: 'Set a goal the agent will keep working towards.',
  },
];

/** Toggling the active mode off targets the agent's normal mode. TODO(backend): confirm how the
 * contract represents "no special mode"; agents conventionally advertise it as `default`. */
export const DEFAULT_MODE_ID = 'default';
