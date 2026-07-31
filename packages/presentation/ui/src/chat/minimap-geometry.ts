import { clamp } from 'foxts/clamp';

/** Row pitch. One turn per row regardless of its length, so a tick's hit area never shrinks. */
export const MINIMAP_ROW_HEIGHT = 18;

/** Pointer distance at which magnification reaches zero — three rows. */
export const MINIMAP_FISHEYE_SPREAD = 54;

export interface MinimapTickDims {
  baseWidth: number;
  baseHeight: number;
  peakWidth: number;
  peakHeight: number;
}

export const MINIMAP_TURN_TICK: MinimapTickDims = {
  baseWidth: 12,
  baseHeight: 3,
  peakWidth: 39,
  peakHeight: 6,
};

/**
 * Dock-style magnification: 1 under the pointer, 0 at `spread` and beyond, eased so the falloff
 * reads as a curve rather than a cone.
 */
export function fisheyeFactor(distance: number, spread = MINIMAP_FISHEYE_SPREAD): number {
  const t = 1 - Math.abs(distance) / spread;
  return t <= 0 ? 0 : 1 - (1 - t) ** 3;
}

export function fisheyeSize(
  dims: MinimapTickDims,
  factor: number,
): { width: number; height: number } {
  return {
    width: dims.baseWidth + (dims.peakWidth - dims.baseWidth) * factor,
    height: dims.baseHeight + (dims.peakHeight - dims.baseHeight) * factor,
  };
}

/**
 * Where the rail scrolls itself so the conversation's visible turns sit centered in it. Ticks are
 * evenly spaced, so a long thread outgrows the rail and the rail follows the viewport instead of
 * compressing — `end` is inclusive.
 */
export function railScrollTopFor(
  visible: { start: number; end: number },
  count: number,
  railHeight: number,
  rowHeight = MINIMAP_ROW_HEIGHT,
): number {
  const overflow = count * rowHeight - railHeight;
  if (overflow <= 0) return 0;
  const center = ((visible.start + visible.end + 1) / 2) * rowHeight;
  return clamp(center - railHeight / 2, 0, overflow);
}
