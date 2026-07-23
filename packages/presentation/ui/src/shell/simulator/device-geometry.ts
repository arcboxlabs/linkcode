/**
 * Device ↔ screen coordinate mapping for the simulator canvas. Pure geometry, no React or DOM
 * events: given the painted canvas (chassis + screen in native pixels, drawn `object-contain`),
 * it recovers where the real device screen sits on the page and maps a page point into the
 * device's normalized [0,1] space. Shared by the compositor (which lays the chassis out with the
 * same fractions) and the input handlers.
 */

import { clamp } from 'foxts/clamp';

export interface SimulatorScreenPoint {
  x: number;
  y: number;
}

export interface DeviceRect {
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

/** The painted device's on-page box (the canvas is `object-contain`, so it may be letterboxed). */
export function deviceRectOnPage(canvas: HTMLCanvasElement): DeviceRect {
  const rect = canvas.getBoundingClientRect();
  if (canvas.width === 0 || canvas.height === 0) return rect;
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

/** The screen's on-page box: the device box inset by the chassis band and button margin. */
export function screenRectOnPage(canvas: HTMLCanvasElement): DeviceRect {
  const device = deviceRectOnPage(canvas);
  if (canvas.width === 0) return device;
  // Recover the native insets the painter rounded from the screen width.
  const approxScreenWidth = canvas.width / (1 + 2 * PAD_FRACTION + 2 * BUTTON_DEPTH_FRACTION);
  const pad = Math.round(approxScreenWidth * PAD_FRACTION);
  const buttonDepth = Math.round(approxScreenWidth * BUTTON_DEPTH_FRACTION);
  const scale = device.width / canvas.width;
  return {
    left: device.left + (pad + buttonDepth) * scale,
    top: device.top + pad * scale,
    width: (canvas.width - 2 * pad - 2 * buttonDepth) * scale,
    height: (canvas.height - 2 * pad) * scale,
  };
}

/** Map a page point (a pointer/wheel event) into the device's normalized [0,1] screen space. */
export function normalizedPoint(event: {
  clientX: number;
  clientY: number;
  currentTarget: HTMLCanvasElement;
}): SimulatorScreenPoint {
  const screen = screenRectOnPage(event.currentTarget);
  return {
    x: clamp((event.clientX - screen.left) / screen.width, 0, 1),
    y: clamp((event.clientY - screen.top) / screen.height, 0, 1),
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
