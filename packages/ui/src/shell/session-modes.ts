import type { SessionMode } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useState } from 'react';

/**
 * Two different product concepts share the agent's single session-mode channel:
 *
 * - **Approval policy** — the standing permission posture: how the agent's actions get approved
 *   (ask every time / auto-approve safe actions / full access). Picking one is a lasting choice.
 * - **Plan mode** — a work-phase toggle: the agent researches and proposes a plan instead of
 *   acting. Turning it off returns to normal execution under the previous approval policy.
 *
 * Agents advertise both as `SessionMode`s with exactly one active at a time (`currentModeId`), so
 * this hook demultiplexes the shared channel: the mode with id `plan` becomes the plan toggle,
 * every other mode a policy option, and the last active policy is remembered so leaving plan
 * restores it. Mode changes are fire-and-forget — the active mode is only ever reflected back
 * from the session's `current-mode-update` event, never assumed locally.
 */

const PLAN_MODE_ID = 'plan';

export interface ApprovalPolicyControl {
  /** The postures the agent offers (every advertised mode except `plan`). */
  options: SessionMode[];
  /** The posture in effect — while plan mode is on, the one leaving plan will restore. */
  active: SessionMode;
  select: (modeId: string) => void;
}

export interface PlanModeControl {
  mode: SessionMode;
  active: boolean;
  toggle: () => void;
}

export function useSessionModeControls(
  currentModeId: string | null,
  availableModes: readonly SessionMode[],
  onModeChange: ((modeId: string) => Promise<void>) | undefined,
): { policy: ApprovalPolicyControl | null; plan: PlanModeControl | null } {
  // Render-phase adjustment (react.dev: "adjusting state when a prop changes") — the update is
  // self-limiting because the condition compares against the state being set. The useEffect
  // version is both slower (extra committed render) and rejected by react-no-use-effect-watching.
  const [lastPolicyId, setLastPolicyId] = useState<string | null>(null);
  if (currentModeId && currentModeId !== PLAN_MODE_ID && currentModeId !== lastPolicyId) {
    setLastPolicyId(currentModeId);
  }

  // Without a change handler neither concept is actionable; callers fall back to read-only UI.
  if (!onModeChange) return { policy: null, plan: null };

  let advertisedPlan: SessionMode | null = null;
  const options: SessionMode[] = [];
  for (const mode of availableModes) {
    if (mode.modeId === PLAN_MODE_ID) advertisedPlan = mode;
    else options.push(mode);
  }
  const planMode = advertisedPlan;

  const select = (modeId: string): void => {
    // Failures surface via the workbench error banner; the mode simply stays where it was.
    void onModeChange(modeId).catch(noop);
  };

  const planActive = currentModeId === PLAN_MODE_ID;
  const activePolicyId = planActive ? lastPolicyId : currentModeId;

  const policy: ApprovalPolicyControl | null =
    options.length > 0
      ? { options, active: modeById(options, activePolicyId) ?? options[0], select }
      : null;

  const plan: PlanModeControl | null = planMode
    ? {
        mode: planMode,
        active: planActive,
        toggle() {
          const target = planActive ? (activePolicyId ?? options[0]?.modeId) : planMode.modeId;
          if (target) select(target);
        },
      }
    : null;

  return { policy, plan };
}

// Linear lookup: agents advertise a handful of modes at most.
function modeById(modes: readonly SessionMode[], modeId: string | null): SessionMode | undefined {
  for (const mode of modes) {
    if (mode.modeId === modeId) return mode;
  }
  return undefined;
}
