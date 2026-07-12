import type { AllotmentHandle } from 'allotment';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useReducedMotion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';

// Duration and bezier are duplicated in index.css (the `--lc-*` transition under
// [data-shell-animating]) — keep both in sync.
export const SHELL_TRANSITION = {
  durationMs: 300,
  cssEase: 'cubic-bezier(0.2, 0, 0, 1)',
};

export type SplitPanePhase = 'closed' | 'opening' | 'open' | 'closing';

export interface AnimatedSplit {
  setAllotmentHandle: (handle: AllotmentHandle | null) => void;
  setPaneSize: (size: number) => void;
  allowZeroSize: boolean;
  isAnimating: boolean;
  paneVisible: boolean;
  phase: SplitPanePhase;
  reducedMotion: boolean;
  onChange: (sizes: number[]) => void;
}

interface UseAnimatedSplitOptions {
  open: boolean;
  paneIndex: 0 | 1;
  paneSize: number;
  restSize?: number;
  onPaneSizeChange?: (size: number) => void;
}

type SplitSizes = [number, number];

export interface SplitTransitionState {
  requestedOpen: boolean;
  phase: SplitPanePhase;
  targetPaneSize: number;
  version: number;
}

export function useAnimatedSplit({
  open,
  paneIndex,
  paneSize,
  restSize = 1000,
  onPaneSizeChange,
}: UseAnimatedSplitOptions): AnimatedSplit {
  const allotmentRef = useRef<AllotmentHandle | null>(null);
  const sizesRef = useRef<SplitSizes>(createInitialSizes(open, paneIndex, paneSize, restSize));

  const reducedMotion = useReducedMotion() ?? false;

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
    targetPaneSize: open ? Math.max(0, paneSize) : 0,
    version: 0,
  }));

  // Derive the next transition from the latest `open` request during render — React's prescribed way
  // to adjust state when props change (it re-renders before paint, avoiding an effect round-trip).
  const active = reconcileTransition(transition, open, paneSize, reducedMotion);
  if (active !== transition) setTransition(active);
  const { phase, targetPaneSize, version: transitionVersion } = active;

  const setAllotmentHandle = useCallback((handle: AllotmentHandle | null): void => {
    allotmentRef.current = handle;
  }, []);

  const applyPaneSize = useCallback(
    (size: number): void => {
      const next = composePaneSizes(sizesRef.current, paneIndex, size);

      sizesRef.current = next;
      onPaneSizeChange?.(readPaneSize(next, paneIndex));
      allotmentRef.current?.resize(next);
    },
    [onPaneSizeChange, paneIndex],
  );

  const setPaneSize = useCallback(
    (size: number): void => {
      applyPaneSize(size);
    },
    [applyPaneSize],
  );

  const onChange = useCallback(
    (sizes: number[]): void => {
      const next = normalizeSplitSizes(sizes, sizesRef.current);

      sizesRef.current = next;
      onPaneSizeChange?.(readPaneSize(next, paneIndex));
    },
    [onPaneSizeChange, paneIndex],
  );

  // Commit the final layout once, before paint. Opening resizes straight to the target — this
  // also overrides Allotment's cached-size restore, which runs in its own (child) layout effect
  // first — and the pane content then slides in via a compositor transition over the settled
  // layout. Closing leaves the layout at full size so there is something to slide out; only the
  // chrome CSS variable is retargeted now, so the titlebar transitions down in sync with the
  // slide, and the layout commit is deferred to the settle timer below.
  useLayoutEffect(() => {
    if (phase === 'opening') {
      applyPaneSize(targetPaneSize);
    } else if (phase === 'closing') {
      onPaneSizeChange?.(0);
    }
  }, [applyPaneSize, onPaneSizeChange, phase, targetPaneSize]);

  useAbortableEffect(
    (signal) => {
      if (transitionVersion === 0) return;

      if (phase === 'open' || phase === 'closed') {
        if (readPaneSize(sizesRef.current, paneIndex) !== targetPaneSize) {
          applyPaneSize(targetPaneSize);
        }

        return;
      }

      const completedPhase: SplitPanePhase = phase === 'opening' ? 'open' : 'closed';

      // CSS transitions drive the visuals; this timer only settles the phase (and commits the
      // deferred close) once they are done. A timer instead of `transitionend`: Chromium
      // throttles occluded windows, and the phase must settle even if no frame is ever painted.
      const settle = setTimeout(() => {
        if (signal.aborted) return;

        if (phase === 'closing') applyPaneSize(targetPaneSize);

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
    [applyPaneSize, paneIndex, phase, setTransition, targetPaneSize, transitionVersion],
  );

  const paneVisible = open || phase !== 'closed';
  const isAnimating = isAnimatingPhase(phase);

  return {
    setAllotmentHandle,
    setPaneSize,
    allowZeroSize: open ? phase !== 'open' : phase !== 'closed',
    isAnimating,
    paneVisible,
    phase,
    reducedMotion,
    onChange,
  };
}

export function getShellContentMotionStyle({
  axis,
  phase,
  reducedMotion,
  reverse = false,
}: {
  axis: 'x' | 'y';
  phase: SplitPanePhase;
  reducedMotion: boolean;
  reverse?: boolean;
}): React.CSSProperties {
  const visible = phase === 'open' || phase === 'opening';
  const offset = visible ? '0%' : reverse ? '-100%' : '100%';

  return {
    opacity: visible || reducedMotion ? 1 : 0,
    // Settled-open drops the transform entirely: a resting translate3d would pin a compositor
    // layer and a containing block on the whole pane subtree. `none` → translate still
    // transitions (none is the identity), so the closing slide starts cleanly from here.
    transform:
      phase === 'open' || reducedMotion
        ? undefined
        : axis === 'x'
          ? `translate3d(${offset}, 0, 0)`
          : `translate3d(0, ${offset}, 0)`,
    transition: reducedMotion
      ? 'none'
      : `opacity ${SHELL_TRANSITION.durationMs}ms ${SHELL_TRANSITION.cssEase}, transform ${SHELL_TRANSITION.durationMs}ms ${SHELL_TRANSITION.cssEase}`,
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

function createInitialSizes(
  open: boolean,
  paneIndex: 0 | 1,
  paneSize: number,
  restSize: number,
): SplitSizes {
  const safePaneSize = open ? Math.max(0, paneSize) : 0;
  const safeRestSize = Math.max(0, restSize);

  return paneIndex === 0 ? [safePaneSize, safeRestSize] : [safeRestSize, safePaneSize];
}

function normalizeSplitSizes(sizes: number[], fallback: SplitSizes): SplitSizes {
  const first =
    typeof sizes[0] === 'number' && Number.isFinite(sizes[0]) ? Math.max(0, sizes[0]) : fallback[0];

  const second =
    typeof sizes[1] === 'number' && Number.isFinite(sizes[1]) ? Math.max(0, sizes[1]) : fallback[1];

  return [first, second];
}

function composePaneSizes(current: SplitSizes, paneIndex: 0 | 1, paneSize: number): SplitSizes {
  const total = Math.max(1, current[0] + current[1]);
  const safePaneSize = Math.max(0, paneSize);
  const restSize = Math.max(0, total - safePaneSize);

  return paneIndex === 0 ? [safePaneSize, restSize] : [restSize, safePaneSize];
}

function readPaneSize(sizes: SplitSizes, paneIndex: 0 | 1): number {
  const size = sizes[paneIndex];

  return Number.isFinite(size) ? Math.max(0, size) : 0;
}
