import { createFixedArray } from 'foxts/create-fixed-array';
import { describe, expect, it } from 'vitest';
import {
  fisheyeFactor,
  fisheyeWidth,
  MINIMAP_FISHEYE_SPREAD,
  MINIMAP_ROW_HEIGHT,
  MINIMAP_TICK_BASE_WIDTH,
  MINIMAP_TICK_PEAK_WIDTH,
  railScrollTopFor,
} from '../minimap-geometry';

describe('fisheyeFactor', () => {
  it('peaks under the pointer and dies at the spread', () => {
    expect(fisheyeFactor(0)).toBe(1);
    expect(fisheyeFactor(MINIMAP_FISHEYE_SPREAD)).toBe(0);
    expect(fisheyeFactor(MINIMAP_FISHEYE_SPREAD * 4)).toBe(0);
  });

  it('is symmetric, so ticks above and below the pointer grow alike', () => {
    expect(fisheyeFactor(-20)).toBe(fisheyeFactor(20));
  });

  it('decreases monotonically across the falloff', () => {
    const step = MINIMAP_FISHEYE_SPREAD / 6;
    const samples = createFixedArray(7).map((_, i) => fisheyeFactor(i * step));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
  });

  it('eases out — the near half of the falloff keeps most of the magnification', () => {
    expect(fisheyeFactor(MINIMAP_FISHEYE_SPREAD / 2)).toBeGreaterThan(0.5);
  });
});

describe('fisheyeWidth', () => {
  it('spans exactly base to peak', () => {
    expect(fisheyeWidth(0)).toBe(MINIMAP_TICK_BASE_WIDTH);
    expect(fisheyeWidth(1)).toBe(MINIMAP_TICK_PEAK_WIDTH);
  });

  it('interpolates linearly between them', () => {
    expect(fisheyeWidth(0.5)).toBe((MINIMAP_TICK_BASE_WIDTH + MINIMAP_TICK_PEAK_WIDTH) / 2);
  });
});

describe('railScrollTopFor', () => {
  const railHeight = MINIMAP_ROW_HEIGHT * 10;

  it('does not scroll while every turn fits', () => {
    expect(railScrollTopFor({ start: 0, end: 4 }, 8, railHeight)).toBe(0);
  });

  it('centers the visible range once the rail overflows', () => {
    // Rows 20..29 → center at row 25 → 25 pitches, less half a rail.
    expect(railScrollTopFor({ start: 20, end: 29 }, 100, railHeight)).toBe(
      25 * MINIMAP_ROW_HEIGHT - railHeight / 2,
    );
  });

  it('clamps at both ends instead of overscrolling', () => {
    expect(railScrollTopFor({ start: 0, end: 3 }, 100, railHeight)).toBe(0);
    expect(railScrollTopFor({ start: 96, end: 99 }, 100, railHeight)).toBe(
      100 * MINIMAP_ROW_HEIGHT - railHeight,
    );
  });
});
