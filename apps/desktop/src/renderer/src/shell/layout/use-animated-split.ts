import type { AllotmentHandle } from 'allotment';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { animate } from 'motion';
import { useReducedMotion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

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

interface SplitTransitionState {
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

  const [transition, setTransition] = useState<SplitTransitionState>(() => ({
    requestedOpen: open,
    phase: open ? 'open' : 'closed',
    targetPaneSize: open ? Math.max(0, paneSize) : 0,
    shouldStartFromZero: false,
    version: 0,
  }));

  let currentTransition = transition;

  // Capture the target pane size at the moment `open` changes.
  //
  // During animation, `onPaneSizeChange` may update the controlled `paneSize`.
  // If the animation effect directly depended on `paneSize`, it could restart
  // on every animation frame. This state records the transition request instead.
  if (currentTransition.requestedOpen !== open) {
    currentTransition = {
      requestedOpen: open,
      phase: reducedMotion ? (open ? 'open' : 'closed') : open ? 'opening' : 'closing',
      targetPaneSize: open ? Math.max(0, paneSize) : 0,
      shouldStartFromZero: !reducedMotion && open && currentTransition.phase === 'closed',
      version: currentTransition.version + 1,
    };

    setTransition(currentTransition);
  } else if (reducedMotion && isAnimatingPhase(currentTransition.phase)) {
    currentTransition = {
      ...currentTransition,
      phase: currentTransition.requestedOpen ? 'open' : 'closed',
      shouldStartFromZero: false,
      version: currentTransition.version + 1,
    };

    setTransition(currentTransition);
  }

  const {
    phase,
    shouldStartFromZero,
    targetPaneSize,
    version: transitionVersion,
  } = currentTransition;

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

      const controls = animate(startSize, targetPaneSize, {
        duration: SHELL_TRANSITION.duration,
        ease: SHELL_TRANSITION.ease,
        onUpdate(latest) {
          if (!signal.aborted) applyPaneSize(latest);
        },
        onComplete() {
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
        },
      });

      return () => {
        controls.stop();
      };
    },
    [applyPaneSize, paneIndex, phase, shouldStartFromZero, targetPaneSize, transitionVersion],
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
}): CSSProperties {
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
