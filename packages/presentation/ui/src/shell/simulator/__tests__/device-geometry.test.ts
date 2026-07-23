import { describe, expect, it } from 'vitest';
import { mirrorPoint, normalizedPoint, screenRectOnPage } from '../device-geometry';

/** The slice of `HTMLCanvasElement` the geometry helpers read. */
type CanvasStub = Pick<HTMLCanvasElement, 'width' | 'height' | 'getBoundingClientRect'>;

/** A canvas stub with a controllable native size and on-page rect. */
function fakeCanvas(native: { w: number; h: number }, rect: DOMRect): HTMLCanvasElement {
  const stub: CanvasStub = {
    width: native.w,
    height: native.h,
    getBoundingClientRect: () => rect,
  };
  return stub as HTMLCanvasElement;
}

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

describe('mirrorPoint', () => {
  it('reflects about the origin and clamps to the screen', () => {
    expect(mirrorPoint({ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 })).toEqual({ x: 0.7, y: 0.6 });
    // A reflection past an edge is clamped into [0,1].
    expect(mirrorPoint({ x: 0.2, y: 0.2 }, { x: 0.9, y: 0.9 })).toEqual({ x: 0, y: 0 });
  });
});

describe('screenRectOnPage / normalizedPoint', () => {
  // A device whose canvas is drawn 1:1 on the page (no letterboxing).
  const nativeW = 1296;
  const nativeH = 2690;
  const canvas = fakeCanvas({ w: nativeW, h: nativeH }, rect(0, 0, nativeW, nativeH));

  it('insets the screen box by the chassis band and button margin', () => {
    const screen = screenRectOnPage(canvas);
    // The screen sits inside the device box, narrower and shorter than the full canvas.
    expect(screen.left).toBeGreaterThan(0);
    expect(screen.top).toBeGreaterThan(0);
    expect(screen.width).toBeLessThan(nativeW);
    expect(screen.height).toBeLessThan(nativeH);
    // Symmetric horizontal insets.
    expect(screen.left).toBeCloseTo(nativeW - (screen.left + screen.width), 0);
  });

  it('maps the screen-box corners to the normalized unit square', () => {
    const screen = screenRectOnPage(canvas);
    const topLeft = normalizedPoint({
      clientX: screen.left,
      clientY: screen.top,
      currentTarget: canvas,
    });
    const bottomRight = normalizedPoint({
      clientX: screen.left + screen.width,
      clientY: screen.top + screen.height,
      currentTarget: canvas,
    });
    expect(topLeft).toEqual({ x: 0, y: 0 });
    expect(bottomRight).toEqual({ x: 1, y: 1 });
  });

  it('clamps a point outside the screen box into [0,1]', () => {
    const outside = normalizedPoint({ clientX: -50, clientY: -50, currentTarget: canvas });
    expect(outside).toEqual({ x: 0, y: 0 });
  });
});
