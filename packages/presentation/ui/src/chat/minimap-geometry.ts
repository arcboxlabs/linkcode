import { clamp } from 'foxts/clamp';

/** Row pitch. One turn per row regardless of its length, so a tick's hit area never shrinks. */
export const MINIMAP_ROW_HEIGHT = 14;

/** Resting and fully magnified tick width. Height never changes — a 2px hairline swelling into a
 * 5px lozenge reads as a blob, where width alone reads as the line extending. */
export const MINIMAP_TICK_BASE_WIDTH = 8;
export const MINIMAP_TICK_PEAK_WIDTH = 28;

/** Pointer distance at which magnification reaches zero — three rows either side. */
export const MINIMAP_FISHEYE_SPREAD = 42;

/**
 * Dock-style magnification: 1 under the pointer, 0 at `spread` and beyond, eased so neighbours fall
 * away along a curve rather than a cone.
 */
export function fisheyeFactor(distance: number, spread = MINIMAP_FISHEYE_SPREAD): number {
  const t = 1 - Math.abs(distance) / spread;
  return t <= 0 ? 0 : 1 - (1 - t) ** 3;
}

export function fisheyeWidth(factor: number): number {
  return MINIMAP_TICK_BASE_WIDTH + (MINIMAP_TICK_PEAK_WIDTH - MINIMAP_TICK_BASE_WIDTH) * factor;
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
