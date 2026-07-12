import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useReducedMotion } from 'motion/react';
import { useState } from 'react';

// Duration and bezier are duplicated in index.css (the workspace/chrome grid transitions
// under [data-shell-animating]) — keep both in sync.
export const SHELL_TRANSITION = {
  durationMs: 300,
  cssEase: 'cubic-bezier(0.2, 0, 0, 1)',
};

export type SplitPanePhase = 'closed' | 'opening' | 'open' | 'closing';

export interface PaneTransition {
  phase: SplitPanePhase;
  isAnimating: boolean;
  paneVisible: boolean;
  reducedMotion: boolean;
}

interface UsePaneTransitionOptions {
  open: boolean;
  /** The pane's settled (open) size in px, from the layout store. */
  size: number;
  /** Writes the pane's shell CSS variable — the single geometry input for the workspace
   * grid tracks and the titlebar chrome. */
  onSizeChange?: (size: number) => void;
}

export interface SplitTransitionState {
  requestedOpen: boolean;
  phase: SplitPanePhase;
  targetPaneSize: number;
  version: number;
}

/**
 * Phase machine for a shell pane toggle. The pane's geometry is a CSS variable: this hook
 * writes it once per change and the scoped grid transitions in index.css interpolate the
 * consuming templates — no per-frame JS. The phases exist for everything that must bracket
 * the 300ms visual: the [data-shell-animating] attribute, content locks, terminal
 * suspension, and lazy mounting.
 */
export function usePaneTransition({
  open,
  size,
  onSizeChange,
}: UsePaneTransitionOptions): PaneTransition {
  const reducedMotion = useReducedMotion() ?? false;

  // Plain useState with whole-object replacement. The whole transition object feeds into
  // reconcileTransition, so the React Compiler keys that memo on the object's IDENTITY — and a
  // tracked-getter store (foxact useStateWithDeps) deliberately keeps one stable reference and
  // mutates inside (it is not a snapshot). Completion-driven phase updates (same `open`, new
  // phase) then rendered from the stale memoized reconcile result and the phase never left
  // 'opening'/'closing'. Field-granular reads off a tracked store stay compiler-safe (the dep
  // check re-reads through the getters); passing the whole object as a dependency is what breaks,
  // and this version-counted, render-phase-adjusted machine wants snapshot semantics anyway.
  // Plain useState with whole-object replacement. The whole transition object feeds into
  // reconcileTransition, so the React Compiler keys that memo on the object's IDENTITY — and a
  // tracked-getter store (foxact useStateWithDeps) deliberately keeps one stable reference and
  // mutates inside (it is not a snapshot). Completion-driven phase updates (same `open`, new
  // phase) then rendered from the stale memoized reconcile result and the phase never left
  // 'opening'/'closing'. Field-granular reads off a tracked store stay compiler-safe (the dep
  // check re-reads through the getters); passing the whole object as a dependency is what breaks,
  // and this version-counted, render-phase-adjusted machine wants snapshot semantics anyway.
  const [transition, setTransition] = useState<SplitTransitionState>(() => ({
    requestedOpen: open,
    phase: open ? 'open' : 'closed',
    targetPaneSize: open ? Math.max(0, size) : 0,
    version: 0,
  }));

  // Derive the next transition from the latest `open` request during render — React's prescribed way
  // to adjust state when props change (it re-renders before paint, avoiding an effect round-trip).
  const active = reconcileTransition(transition, open, size, reducedMotion);
  if (active !== transition) setTransition(active);
  const { phase, version: transitionVersion } = active;

  // Written pre-paint so the variable lands in the same style recalc as the
  // [data-shell-animating] attribute and the content locks. Sash drags write the same
  // variable imperatively per frame (no transition — the attribute is absent) and commit
  // to the store on release, which re-runs this effect with the same value.
  useLayoutEffect(() => {
    onSizeChange?.(open ? Math.max(0, size) : 0);
  }, [onSizeChange, open, size]);

  useAbortableEffect(
    (signal) => {
      if (transitionVersion === 0) return;
      if (!isAnimatingPhase(phase)) return;

      const completedPhase: SplitPanePhase = phase === 'opening' ? 'open' : 'closed';

      // CSS transitions drive the visuals; this timer only settles the phase once they are
      // done. A timer instead of `transitionend`: Chromium throttles occluded windows, and
      // the phase must settle even if no frame is ever painted.
      const settle = setTimeout(() => {
        if (signal.aborted) return;

        setTransition((latest) => {
          if (latest.version !== transitionVersion) return latest;

          return {
            ...latest,
            phase: completedPhase,
          };
        });
      }, SHELL_TRANSITION.durationMs + 100);

      return () => clearTimeout(settle);
    },
    [phase, setTransition, transitionVersion],
  );

  return {
    phase,
    isAnimating: isAnimatingPhase(phase),
    paneVisible: open || phase !== 'closed',
    reducedMotion,
  };
}

function isAnimatingPhase(phase: SplitPanePhase): boolean {
  return phase === 'opening' || phase === 'closing';
}

/**
 * Derive the next transition from the latest `open` request, returning the same reference when
 * nothing changed so the caller can skip the state update. The target pane size is snapshotted here
 * rather than read live in the transition effects, which would otherwise restart mid-transition as
 * the controlled `paneSize` updates.
 */
export function reconcileTransition(
  current: SplitTransitionState,
  open: boolean,
  paneSize: number,
  reducedMotion: boolean,
): SplitTransitionState {
  if (current.requestedOpen !== open) {
    return {
      requestedOpen: open,
      phase: reducedMotion ? (open ? 'open' : 'closed') : open ? 'opening' : 'closing',
      targetPaneSize: open ? Math.max(0, paneSize) : 0,
      version: current.version + 1,
    };
  }

  if (reducedMotion && isAnimatingPhase(current.phase)) {
    return {
      ...current,
      phase: current.requestedOpen ? 'open' : 'closed',
      version: current.version + 1,
    };
  }

  return current;
}
