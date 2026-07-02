import type { AllotmentHandle } from 'allotment';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { animate } from 'motion';
import { useReducedMotion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';

export const SHELL_TRANSITION = {
  duration: 0.18,
  durationMs: 180,
  ease: [0.2, 0, 0, 1] as [number, number, number, number],
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
  shouldStartFromZero: boolean;
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

  // Plain useState with whole-object replacement — every change produces a new reference. A
  // tracked-getter store (foxact useStateWithDeps) is referentially stable while mutating inside,
  // which the React Compiler's memoization reads as "nothing changed": completion-driven phase
  // updates (same `open`, new phase) would render from the stale memoized reconcile result and
  // the phase would stay 'opening'/'closing' forever.
  const [transition, setTransition] = useState<SplitTransitionState>(() => ({
    requestedOpen: open,
    phase: open ? 'open' : 'closed',
    targetPaneSize: open ? Math.max(0, paneSize) : 0,
    shouldStartFromZero: false,
    version: 0,
  }));

  // Derive the next transition from the latest `open` request during render — React's prescribed way
  // to adjust state when props change (it re-renders before paint, avoiding an effect round-trip).
  const active = reconcileTransition(transition, open, paneSize, reducedMotion);
  if (active !== transition) setTransition(active);
  const { phase, shouldStartFromZero, targetPaneSize, version: transitionVersion } = active;

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

  // Snap the pane to its closed (zero) start position before paint when opening from a closed
  // state. Allotment restores the pane's cached visible size in its own (child) layout effect, so
  // without this pre-paint reset the panel flashes one full-width frame before the post-paint
  // animation effect drives it from zero.
  useLayoutEffect(() => {
    if (shouldStartFromZero && phase === 'opening') {
      applyPaneSize(0);
    }
  }, [applyPaneSize, phase, shouldStartFromZero]);

  useAbortableEffect(
    (signal) => {
      if (transitionVersion === 0) return;

      if (phase === 'open' || phase === 'closed') {
        if (readPaneSize(sizesRef.current, paneIndex) !== targetPaneSize) {
          applyPaneSize(targetPaneSize);
        }

        return;
      }

      const startSize = shouldStartFromZero ? 0 : readPaneSize(sizesRef.current, paneIndex);
      const completedPhase: SplitPanePhase = phase === 'opening' ? 'open' : 'closed';

      applyPaneSize(startSize);

      const finish = (): void => {
        if (signal.aborted) return;

        applyPaneSize(targetPaneSize);

        setTransition((latest) => {
          if (latest.version !== transitionVersion) return latest;

          return {
            ...latest,
            phase: completedPhase,
            shouldStartFromZero: false,
          };
        });
      };

      const controls = animate(startSize, targetPaneSize, {
        duration: SHELL_TRANSITION.duration,
        ease: SHELL_TRANSITION.ease,
        onUpdate(latest) {
          if (!signal.aborted) applyPaneSize(latest);
        },
        onComplete: finish,
      });

      // The animation runs on rAF, which Chromium throttles to a standstill in occluded windows —
      // onComplete would then never fire and the phase would stay 'opening'/'closing' forever.
      // Force completion once the duration has passed; after a real completion this is a no-op.
      const fallback = setTimeout(() => {
        controls.stop();
        finish();
      }, SHELL_TRANSITION.durationMs + 100);

      return () => {
        clearTimeout(fallback);
        controls.stop();
      };
    },
    [
      applyPaneSize,
      paneIndex,
      phase,
      setTransition,
      shouldStartFromZero,
      targetPaneSize,
      transitionVersion,
    ],
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
  const offset = visible || reducedMotion ? 0 : reverse ? -8 : 8;

  return {
    opacity: visible || reducedMotion ? 1 : 0,
    transform: axis === 'x' ? `translate3d(${offset}px, 0, 0)` : `translate3d(0, ${offset}px, 0)`,
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
 * rather than read live in the animation effect, which would otherwise restart every frame as the
 * controlled `paneSize` updates during the animation.
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
      shouldStartFromZero: !reducedMotion && open && current.phase === 'closed',
      version: current.version + 1,
    };
  }

  if (reducedMotion && isAnimatingPhase(current.phase)) {
    return {
      ...current,
      phase: current.requestedOpen ? 'open' : 'closed',
      shouldStartFromZero: false,
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
