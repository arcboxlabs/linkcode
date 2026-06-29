import type { AllotmentHandle } from 'allotment';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { animate } from 'motion';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

export function useAnimatedSplit({
  open,
  paneIndex,
  paneSize,
  restSize = 1000,
  onPaneSizeChange,
}: UseAnimatedSplitOptions): AnimatedSplit {
  const allotmentRef = useRef<AllotmentHandle | null>(null);
  const sizesRef = useRef<SplitSizes>(createInitialSizes(open, paneIndex, paneSize, restSize));
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const mountedRef = useRef(false);
  const lastOpenRef = useRef(open);
  const onPaneSizeChangeRef = useRef(onPaneSizeChange);
  const paneSizeRef = useRef(paneSize);
  const [phaseStore] = useState(() => createPhaseStore(open ? 'open' : 'closed'));
  const phase = useSyncExternalStore(
    phaseStore.subscribe,
    phaseStore.getSnapshot,
    phaseStore.getSnapshot,
  );
  const phaseRef = useRef<SplitPanePhase>(phase);
  const reducedMotion = useReducedMotion() ?? false;

  const setAllotmentHandle = useCallback((handle: AllotmentHandle | null): void => {
    allotmentRef.current = handle;
  }, []);

  const setPaneSize = useCallback(
    (size: number): void => {
      const next = composePaneSizes(sizesRef.current, paneIndex, size);
      sizesRef.current = next;
      onPaneSizeChangeRef.current?.(readPaneSize(next, paneIndex));
      allotmentRef.current?.resize(next);
    },
    [paneIndex],
  );

  const onChange = useCallback(
    (sizes: number[]): void => {
      sizesRef.current = normalizeSplitSizes(sizes, sizesRef.current);
      onPaneSizeChangeRef.current?.(readPaneSize(sizesRef.current, paneIndex));
    },
    [paneIndex],
  );

  useLayoutEffect(() => {
    paneSizeRef.current = paneSize;
  }, [paneSize]);

  useLayoutEffect(() => {
    onPaneSizeChangeRef.current = onPaneSizeChange;
  }, [onPaneSizeChange]);

  useLayoutEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    if (lastOpenRef.current === open) return;
    lastOpenRef.current = open;

    const setPhaseState = (nextPhase: SplitPanePhase): void => {
      phaseRef.current = nextPhase;
      phaseStore.setPhase(nextPhase);
    };

    const applyPaneSize = (size: number): void => {
      const next = composePaneSizes(sizesRef.current, paneIndex, size);
      sizesRef.current = next;
      onPaneSizeChangeRef.current?.(readPaneSize(next, paneIndex));
      allotmentRef.current?.resize(next);
    };

    animationRef.current?.stop();

    const targetSize = open ? paneSizeRef.current : 0;
    const currentSize = readPaneSize(sizesRef.current, paneIndex);
    const startSize = open && phaseRef.current === 'closed' ? 0 : currentSize;
    const nextPhase: SplitPanePhase = open ? 'opening' : 'closing';

    setPhaseState(nextPhase);
    applyPaneSize(startSize);

    if (reducedMotion || Math.abs(targetSize - startSize) < 0.5) {
      applyPaneSize(targetSize);
      setPhaseState(open ? 'open' : 'closed');
      animationRef.current = null;
      return;
    }

    let controls: ReturnType<typeof animate> | null = null;
    controls = animate(startSize, targetSize, {
      duration: SHELL_TRANSITION.duration,
      ease: SHELL_TRANSITION.ease,
      onUpdate: applyPaneSize,
      onComplete() {
        if (animationRef.current !== controls) return;
        animationRef.current = null;
        setPhaseState(open ? 'open' : 'closed');
      },
    });
    animationRef.current = controls;

    return () => {
      controls.stop();
      if (animationRef.current === controls) animationRef.current = null;
    };
  }, [open, paneIndex, phaseStore, reducedMotion]);

  useEffect(() => () => animationRef.current?.stop(), []);

  const paneVisible = open || phase !== 'closed';
  const isAnimating = phase === 'opening' || phase === 'closing';

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

type SplitSizes = [number, number];

interface PhaseStore {
  getSnapshot: () => SplitPanePhase;
  setPhase: (phase: SplitPanePhase) => void;
  subscribe: (listener: () => void) => () => void;
}

function createPhaseStore(initialPhase: SplitPanePhase): PhaseStore {
  let phase = initialPhase;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => phase,
    setPhase(nextPhase) {
      if (phase === nextPhase) return;
      phase = nextPhase;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createInitialSizes(
  open: boolean,
  paneIndex: 0 | 1,
  paneSize: number,
  restSize: number,
): SplitSizes {
  return paneIndex === 0 ? [open ? paneSize : 0, restSize] : [restSize, open ? paneSize : 0];
}

function normalizeSplitSizes(sizes: number[], fallback: SplitSizes): SplitSizes {
  return [readSize(sizes[0], fallback[0]), readSize(sizes[1], fallback[1])];
}

function composePaneSizes(current: SplitSizes, paneIndex: 0 | 1, paneSize: number): SplitSizes {
  const total = Math.max(1, current[0] + current[1]);
  const safePaneSize = Math.max(0, paneSize);
  const restSize = Math.max(0, total - safePaneSize);
  return paneIndex === 0 ? [safePaneSize, restSize] : [restSize, safePaneSize];
}

function readPaneSize(sizes: SplitSizes, paneIndex: 0 | 1): number {
  return Math.max(0, sizes[paneIndex]);
}

function readSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
