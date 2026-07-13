import {
  getEffectiveSashBounds,
  getKeyboardSashAction,
  getResolvedReclaimTrack,
} from '@renderer/shell/layout/sash-model';
import { describe, expect, it } from 'vitest';

describe('getResolvedReclaimTrack', () => {
  // 1100px frame, main floor 360, right panel preferred 440 with a 320 hard minimum.
  it('keeps the coupled pane at its preferred size while main is above its floor', () => {
    expect(getResolvedReclaimTrack(286, 1100, 360, 440, 320)).toBe(440);
    expect(getResolvedReclaimTrack(300, 1100, 360, 440, 320)).toBe(440);
  });

  it('yields the coupled pane 1:1 once main hits its floor', () => {
    expect(getResolvedReclaimTrack(340, 1100, 360, 440, 320)).toBe(400);
    expect(getResolvedReclaimTrack(420, 1100, 360, 440, 320)).toBe(320);
  });

  it('re-expands a window-clamped coupled pane toward its preferred size', () => {
    // At drag start the right pane was clamped to 354 by a small window; shrinking the
    // dragged pane hands the space back up to the preferred 440, like the CSS clamp does.
    expect(getResolvedReclaimTrack(240, 1000, 360, 440, 320)).toBe(400);
    expect(getResolvedReclaimTrack(200, 1000, 360, 440, 320)).toBe(440);
  });

  it('pins a closed coupled pane at zero', () => {
    expect(getResolvedReclaimTrack(300, 1100, 360, 0, 0)).toBe(0);
  });
});

describe('getEffectiveSashBounds', () => {
  it('caps the pane at the space left above the main floor', () => {
    expect(getEffectiveSashBounds(354, 360, 360, 320, 820)).toEqual({
      min: 320,
      max: 354,
    });
    expect(getEffectiveSashBounds(440, 500, 360, 320, 520)).toEqual({
      min: 320,
      max: 520,
    });
  });

  it('includes space a coupled pane can yield above its hard minimum', () => {
    expect(getEffectiveSashBounds(286, 360, 360, 240, 520, 34)).toEqual({
      min: 240,
      max: 320,
    });
  });

  it('collapses an impossible range instead of inverting it', () => {
    expect(getEffectiveSashBounds(120, 300, 360, 240, 520)).toEqual({
      min: 60,
      max: 60,
    });
  });
});

describe('getKeyboardSashAction', () => {
  const bounds = { min: 240, max: 400 };

  it('maps physical arrow movement through the controlled pane edge', () => {
    expect(
      getKeyboardSashAction({
        key: 'ArrowRight',
        orientation: 'vertical',
        edge: 'start',
        size: 300,
        bounds,
      }),
    ).toBe(310);
    expect(
      getKeyboardSashAction({
        key: 'ArrowRight',
        orientation: 'vertical',
        edge: 'end',
        size: 300,
        bounds,
      }),
    ).toBe(290);
    expect(
      getKeyboardSashAction({
        key: 'ArrowUp',
        orientation: 'horizontal',
        edge: 'end',
        size: 300,
        bounds,
      }),
    ).toBe(310);
  });

  it('maps Home, End, and Enter to their separator actions', () => {
    const options = {
      orientation: 'vertical' as const,
      edge: 'start' as const,
      size: 300,
      bounds,
    };

    expect(getKeyboardSashAction({ ...options, key: 'Home' })).toBe(240);
    expect(getKeyboardSashAction({ ...options, key: 'End' })).toBe(400);
    expect(getKeyboardSashAction({ ...options, key: 'Enter' })).toBe('reset');
    expect(getKeyboardSashAction({ ...options, key: 'Escape' })).toBeNull();
  });
});
