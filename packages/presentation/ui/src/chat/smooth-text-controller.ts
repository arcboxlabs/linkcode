import { useEffect } from 'foxact/use-abortable-effect';
import { useEffect, useRef, useState } from 'react';
import { useRenderPrefs } from '../render-prefs';

const DRAIN_TICKS = 8;
const TICK_MS = 32;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export interface SmoothTextState {
  readonly source: string;
  readonly visible: string;
  readonly pending: readonly string[];
  readonly ticksLeft: number;
}

function settledSmoothText(source: string): SmoothTextState {
  return { source, visible: source, pending: [], ticksLeft: 0 };
}

function pendingGraphemes(source: string, visibleLength: number): string[] {
  const pending: string[] = [];
  for (const { index, segment } of GRAPHEME_SEGMENTER.segment(source)) {
    const offset = visibleLength - index;
    if (offset < segment.length) pending.push(segment.slice(Math.max(0, offset)));
  }
  return pending;
}

export function createSmoothTextState(source: string, buffered: boolean): SmoothTextState {
  if (!buffered || source.length === 0) return settledSmoothText(source);
  return {
    source,
    visible: '',
    pending: pendingGraphemes(source, 0),
    ticksLeft: DRAIN_TICKS,
  };
}

/** Buffer append-only growth; replacements and reduced-motion rendering settle immediately. */
export function reconcileSmoothText(
  current: SmoothTextState,
  source: string,
  immediate: boolean,
): SmoothTextState {
  if (source === current.source) {
    return immediate && current.visible !== source ? settledSmoothText(source) : current;
  }
  if (immediate || !source.startsWith(current.source)) return settledSmoothText(source);

  return {
    source,
    visible: current.visible,
    pending: pendingGraphemes(source, current.visible.length),
    ticksLeft: DRAIN_TICKS,
  };
}

/** Reveal one share of the backlog, reaching the exact source within the remaining ticks. */
export function advanceSmoothText(current: SmoothTextState): SmoothTextState {
  if (current.pending.length === 0) return current;

  const count = Math.ceil(current.pending.length / Math.max(1, current.ticksLeft));
  if (count >= current.pending.length) return settledSmoothText(current.source);

  return {
    ...current,
    visible: current.visible + current.pending.slice(0, count).join(''),
    pending: current.pending.slice(count),
    ticksLeft: Math.max(1, current.ticksLeft - 1),
  };
}

export function useSmoothText(source: string, isStreaming: boolean): string {
  const { reduceMotion } = useRenderPrefs();
  const [state, setState] = useState(() =>
    createSmoothTextState(source, isStreaming && !reduceMotion),
  );
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const immediate = reduceMotion;
  const replaced = source !== state.source && !source.startsWith(state.source);
  const current = immediate || replaced ? reconcileSmoothText(state, source, true) : state;
  if (current !== state) setState(current);

  const active =
    !immediate && (isStreaming || source !== current.source || current.pending.length > 0);
  useEffect(
    (signal) => {
      if (!active) return;
      const timer = window.setInterval(() => {
        if (signal.aborted) return;
        setState((latest) =>
          advanceSmoothText(reconcileSmoothText(latest, sourceRef.current, false)),
        );
      }, TICK_MS);
      return () => window.clearInterval(timer);
    },
    [active],
  );

  return current.visible;
}
