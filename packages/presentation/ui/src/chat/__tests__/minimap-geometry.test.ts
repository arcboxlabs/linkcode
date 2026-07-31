import { describe, expect, it } from 'vitest';
import {
  fisheyeFactor,
  fisheyeSize,
  MINIMAP_FISHEYE_SPREAD,
  MINIMAP_ROW_HEIGHT,
  MINIMAP_TURN_TICK,
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
    const samples = [0, 10, 20, 30, 40, 50, 54].map((d) => fisheyeFactor(d));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1]);
  });

  it('eases out — the near half of the falloff keeps most of the magnification', () => {
    expect(fisheyeFactor(MINIMAP_FISHEYE_SPREAD / 2)).toBeGreaterThan(0.5);
  });
});

describe('fisheyeSize', () => {
  it('spans exactly base to peak', () => {
    expect(fisheyeSize(MINIMAP_TURN_TICK, 0)).toEqual({ width: 12, height: 3 });
    expect(fisheyeSize(MINIMAP_TURN_TICK, 1)).toEqual({ width: 39, height: 6 });
  });

  it('interpolates both axes together', () => {
    expect(fisheyeSize(MINIMAP_TURN_TICK, 0.5)).toEqual({ width: 25.5, height: 4.5 });
  });
});

describe('railScrollTopFor', () => {
  const railHeight = 180; // 10 rows

  it('does not scroll while every turn fits', () => {
    expect(railScrollTopFor({ start: 0, end: 4 }, 8, railHeight)).toBe(0);
  });

  it('centers the visible range once the rail overflows', () => {
    // Rows 20..29 → center at row 25 → 25 * 18 - 90.
    expect(railScrollTopFor({ start: 20, end: 29 }, 100, railHeight)).toBe(360);
  });

  it('clamps at both ends instead of overscrolling', () => {
    expect(railScrollTopFor({ start: 0, end: 3 }, 100, railHeight)).toBe(0);
    expect(railScrollTopFor({ start: 96, end: 99 }, 100, railHeight)).toBe(
      100 * MINIMAP_ROW_HEIGHT - railHeight,
    );
  });
});
