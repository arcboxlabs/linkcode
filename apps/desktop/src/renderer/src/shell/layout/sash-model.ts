import { clamp } from 'foxts/clamp';

export type SashOrientation = 'vertical' | 'horizontal';
export type SashEdge = 'start' | 'end';
export type SashPane = 'sidebar' | 'right' | 'bottom';

export interface SashBounds {
  min: number;
  max: number;
}

const KEYBOARD_RESIZE_STEP = 10;

export function getEffectiveSashBounds(
  paneSize: number,
  mainSize: number,
  minMainSize: number,
  minSize: number,
  maxSize: number,
  reclaimableSize = 0,
): SashBounds {
  const effectiveMax = Math.max(
    0,
    Math.min(maxSize, paneSize + mainSize - minMainSize + reclaimableSize),
  );
  return { min: Math.min(minSize, effectiveMax), max: effectiveMax };
}

/**
 * Resolved size of the coupled (reclaim) track while its neighbor pane is dragged to
 * `paneSize`. Mirrors the CSS clamp coupling in index.css — `--lc-right-col` yields toward
 * its minimum as the sidebar grows past the main floor, and re-expands toward its
 * preferred size when space returns. CSS clamp() semantics: the lower bound wins.
 */
export function getResolvedReclaimTrack(
  paneSize: number,
  frameSize: number,
  minMainSize: number,
  reclaimPreferredSize: number,
  reclaimMinSize: number,
): number {
  const available = frameSize - paneSize - minMainSize;
  return Math.max(
    Math.min(reclaimPreferredSize, reclaimMinSize),
    Math.min(reclaimPreferredSize, available),
  );
}

export function getKeyboardSashAction({
  key,
  orientation,
  edge,
  size,
  bounds,
}: {
  key: string;
  orientation: SashOrientation;
  edge: SashEdge;
  size: number;
  bounds: SashBounds;
}): number | 'reset' | null {
  if (key === 'Enter') return 'reset';
  if (key === 'Home') return bounds.min;
  if (key === 'End') return bounds.max;

  const physicalDelta =
    orientation === 'vertical'
      ? key === 'ArrowLeft'
        ? -KEYBOARD_RESIZE_STEP
        : key === 'ArrowRight'
          ? KEYBOARD_RESIZE_STEP
          : null
      : key === 'ArrowUp'
        ? -KEYBOARD_RESIZE_STEP
        : key === 'ArrowDown'
          ? KEYBOARD_RESIZE_STEP
          : null;
  if (physicalDelta === null) return null;

  const paneDelta = edge === 'start' ? physicalDelta : -physicalDelta;
  return clamp(size + paneDelta, bounds.min, bounds.max);
}
