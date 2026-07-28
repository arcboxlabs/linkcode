import { describe, expect, it } from 'vitest';
import { mirrorPoint, normalizedPoint, screenInset } from '../device-geometry';

/** The slice of `HTMLCanvasElement` `normalizedPoint` reads. */
type CanvasStub = Pick<HTMLCanvasElement, 'getBoundingClientRect'>;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  const value: Omit<DOMRect, 'toJSON'> = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
  return value as DOMRect;
}

/** A canvas stub whose on-page rect is fixed. */
function fakeCanvas(bounds: DOMRect): HTMLCanvasElement {
  const stub: CanvasStub = { getBoundingClientRect: () => bounds };
  return stub as HTMLCanvasElement;
}

describe('mirrorPoint', () => {
  it('reflects about the origin and clamps to the screen', () => {
    expect(mirrorPoint({ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 })).toEqual({ x: 0.7, y: 0.6 });
    // A reflection past an edge is clamped into [0,1].
    expect(mirrorPoint({ x: 0.2, y: 0.2 }, { x: 0.9, y: 0.9 })).toEqual({ x: 0, y: 0 });
  });
});

describe('screenInset', () => {
  const inset = screenInset(1296, 2690);

  it('insets the screen box inside the device box', () => {
    expect(inset.left).toBeGreaterThan(0);
    expect(inset.top).toBeGreaterThan(0);
    expect(inset.width).toBeLessThan(1);
    expect(inset.height).toBeLessThan(1);
  });

  it('leaves symmetric horizontal margins (button + pad on both sides)', () => {
    const rightMargin = 1 - (inset.left + inset.width);
    expect(rightMargin).toBeCloseTo(inset.left, 10);
  });
});

describe('normalizedPoint', () => {
  // The screen canvas is drawn at (0,0), 100×200 CSS px on the page.
  const canvas = fakeCanvas(rect(0, 0, 100, 200));

  it('maps the canvas corners to the normalized unit square', () => {
    expect(normalizedPoint({ clientX: 0, clientY: 0, currentTarget: canvas })).toEqual({
      x: 0,
      y: 0,
    });
    expect(normalizedPoint({ clientX: 100, clientY: 200, currentTarget: canvas })).toEqual({
      x: 1,
      y: 1,
    });
    expect(normalizedPoint({ clientX: 50, clientY: 100, currentTarget: canvas })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it('clamps a point outside the canvas into [0,1]', () => {
    expect(normalizedPoint({ clientX: -50, clientY: 300, currentTarget: canvas })).toEqual({
      x: 0,
      y: 1,
    });
  });
});
