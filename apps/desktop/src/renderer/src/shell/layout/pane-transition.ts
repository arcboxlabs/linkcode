import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useReducedMotion } from 'motion/react';
import { useCallback, useReducer, useRef } from 'react';

// Duration and bezier are duplicated in index.css (the workspace/chrome grid transitions
// under the axis-specific shell animation attributes) — keep both in sync.
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
  settle: () => void;
  rearmFallback: () => void;
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
  version: number;
}

type SplitTransitionAction =
  | { type: 'reconcile'; open: boolean; reducedMotion: boolean }
  | { type: 'settle' }
  | { type: 'settle-if-current'; version: number };

/**
 * Phase machine for a shell pane toggle. Geometry is a CSS variable written once per change — the
 * scoped grid transitions in index.css interpolate the consuming templates, no per-frame JS. The
 * phases bracket the 300ms visual: the axis animation attribute, content locks, terminal
 * suspension, and lazy mounting.
 */
export function usePaneTransition({
  open,
  size,
  onSizeChange,
}: UsePaneTransitionOptions): PaneTransition {
  const reducedMotion = useReducedMotion() ?? false;

  // Reducer snapshots keep the request, phase, and version atomic. A tracked-getter store (foxact
  // useStateWithDeps) keeps one stable, internally-mutated reference, which makes the React Compiler
  // reuse a stale reconciliation result and leaves the phase stuck in 'opening'/'closing'.
  const [transition, dispatchTransition] = useReducer(
    transitionReducer,
    open,
    createInitialTransition,
  );

  // Derive the next transition from the latest `open` request during render — React's prescribed way
  // to adjust state when props change (it re-renders before paint, avoiding an effect round-trip).
  const active = reconcileTransition(transition, open, reducedMotion);
  if (active !== transition) {
    dispatchTransition({ type: 'reconcile', open, reducedMotion });
  }
  const { phase, version: transitionVersion } = active;
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelFallback = useCallback((): void => {
    if (fallbackTimerRef.current === null) return;
    clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }, []);
  const settle = useCallback((): void => {
    cancelFallback();
    dispatchTransition({ type: 'settle' });
  }, [cancelFallback]);
  const rearmFallback = useCallback((): void => {
    cancelFallback();
    fallbackTimerRef.current = setTimeout(() => {
      dispatchTransition({ type: 'settle-if-current', version: transitionVersion });
    }, SHELL_TRANSITION.durationMs + 100);
  }, [cancelFallback, transitionVersion]);

  // Written pre-paint so the variable lands in the same style recalc as the animation attribute
  // and the content locks. Sash drags write the same variable imperatively per frame and commit
  // to the store on release, which re-runs this effect with the same value.
  useLayoutEffect(() => {
    onSizeChange?.(open ? Math.max(0, size) : 0);
  }, [onSizeChange, open, size]);

  useAbortableEffect(() => {
    if (transitionVersion === 0) return;
    if (!isAnimatingPhase(phase)) return;

    // The workspace settles from transitionend. This is only the occluded-window/no-event
    // fallback, rearmed whenever Chromium starts or retargets the real CSS transition.
    rearmFallback();
    return cancelFallback;
  }, [cancelFallback, phase, rearmFallback, transitionVersion]);

  return {
    phase,
    isAnimating: isAnimatingPhase(phase),
    paneVisible: open || phase !== 'closed',
    reducedMotion,
    settle,
    rearmFallback,
  };
}

function isAnimatingPhase(phase: SplitPanePhase): boolean {
  return phase === 'opening' || phase === 'closing';
}

/**
 * Derive the next transition from the latest `open` request, returning the same reference when
 * nothing changed. The version stamps each request so a stale settle timer cannot complete a newer one.
 */
export function reconcileTransition(
  current: SplitTransitionState,
  open: boolean,
  reducedMotion: boolean,
): SplitTransitionState {
  if (current.requestedOpen !== open) {
    return {
      requestedOpen: open,
      phase: reducedMotion ? (open ? 'open' : 'closed') : open ? 'opening' : 'closing',
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

export function settleTransition(current: SplitTransitionState): SplitTransitionState {
  if (!isAnimatingPhase(current.phase)) return current;

  return {
    ...current,
    phase: current.requestedOpen ? 'open' : 'closed',
  };
}

function createInitialTransition(open: boolean): SplitTransitionState {
  return {
    requestedOpen: open,
    phase: open ? 'open' : 'closed',
    version: 0,
  };
}

function transitionReducer(
  current: SplitTransitionState,
  action: SplitTransitionAction,
): SplitTransitionState {
  if (action.type === 'reconcile') {
    return reconcileTransition(current, action.open, action.reducedMotion);
  }
  if (action.type === 'settle') return settleTransition(current);
  return action.version === current.version ? settleTransition(current) : current;
}
