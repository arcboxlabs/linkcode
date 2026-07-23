/**
 * Device ↔ screen geometry for the layered simulator view. Pure geometry, no React or DOM events:
 * the chassis and screen are separate DOM layers (the screen a CSS-positioned canvas inside the
 * chassis box), so mapping a pointer into normalized [0,1] space is just its offset within the
 * screen canvas's own rect. The chassis compositor and this module share the same fractions, so
 * {@link screenInset} places the screen layer exactly over the band's cutout.
 */

import { clamp } from 'foxts/clamp';

export interface SimulatorScreenPoint {
  x: number;
  y: number;
}

/** The screen layer's box as fractions [0,1] of the whole device box, for CSS placement. */
export interface ScreenInset {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Chassis proportions as fractions of the native screen width, matched against Simulator.app's
// iPhone chrome: a thin black display band inside a titanium rim, with side-button bumps.
/** Screen edge → chassis outer edge (black band + rim). */
export const PAD_FRACTION = 0.028;
/** The titanium band's thickness (outermost part of the pad). */
export const RIM_FRACTION = 0.011;
/** How far the side buttons protrude beyond the chassis. */
export const BUTTON_DEPTH_FRACTION = 0.009;
/** Fallback screen corner radius (fraction of width) when the host has no mask to measure. */
export const FALLBACK_CORNER_FRACTION = 0.11;

/** Side buttons as `[top, height]` fractions of the native screen height. */
export const LEFT_BUTTONS: ReadonlyArray<readonly [number, number]> = [
  [0.245, 0.045],
  [0.315, 0.1],
  [0.425, 0.1],
];
export const RIGHT_BUTTONS: ReadonlyArray<readonly [number, number]> = [[0.355, 0.175]];

/** The screen layer's placement within the device box, as fractions of it. Uses the same rounded
 * native insets the chassis compositor paints, so the CSS-positioned screen sits exactly over the
 * band's cutout. */
export function screenInset(screenW: number, screenH: number): ScreenInset {
  const pad = Math.round(screenW * PAD_FRACTION);
  const buttonDepth = Math.round(screenW * BUTTON_DEPTH_FRACTION);
  const deviceW = screenW + 2 * pad + 2 * buttonDepth;
  const deviceH = screenH + 2 * pad;
  return {
    left: (pad + buttonDepth) / deviceW,
    top: pad / deviceH,
    width: screenW / deviceW,
    height: screenH / deviceH,
  };
}

/** Map a page point (a pointer/wheel event on the screen layer) into normalized [0,1] screen
 * space — the offset within the screen canvas's own rect. */
export function normalizedPoint(event: {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
}): SimulatorScreenPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

/** The reflection of `point` about `origin`, clamped to the screen — the second finger of an
 * Option-drag pinch (Simulator.app convention: two fingers symmetric about the press origin). */
export function mirrorPoint(
  origin: SimulatorScreenPoint,
  point: SimulatorScreenPoint,
): SimulatorScreenPoint {
  return {
    x: clamp(2 * origin.x - point.x, 0, 1),
    y: clamp(2 * origin.y - point.y, 0, 1),
  };
}
