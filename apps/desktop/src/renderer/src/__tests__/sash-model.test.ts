import { getEffectiveSashBounds, getKeyboardSashAction } from '@renderer/shell/layout/sash-model';
import { describe, expect, it } from 'vitest';

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
