/**
 * The device compositor: paints one framebuffer frame into a canvas as the whole machine —
 * side-button bumps, a titanium rim + black display band grown from the real screen mask (so the
 * band stays even around the continuous-curvature corners a `roundRect` can't match), and the
 * mask-clipped screen. Pure canvas work, no React: the component owns a {@link CompositorState}
 * and calls {@link paintDevice} whenever a new frame or mask arrives.
 */

import {
  BUTTON_DEPTH_FRACTION,
  FALLBACK_CORNER_FRACTION,
  LEFT_BUTTONS,
  PAD_FRACTION,
  RIGHT_BUTTONS,
  RIM_FRACTION,
} from './device-geometry';

/** A decoded frame the compositor can draw: a bitmap (JPEG path) or a GPU-resident VideoFrame
 * (H.264 path). Both close() and drawImage() uniformly; only the size accessors differ. */
export type DecodedFrame = ImageBitmap | VideoFrame;

export function frameWidth(frame: DecodedFrame): number {
  return 'displayWidth' in frame ? frame.displayWidth : frame.width;
}

export function frameHeight(frame: DecodedFrame): number {
  return 'displayHeight' in frame ? frame.displayHeight : frame.height;
}

/** Everything the compositor retains between paints, in native framebuffer pixels. */
export interface CompositorState {
  mask: ImageBitmap | null;
  /** Last decoded frame, retained so a late-arriving mask can recomposite it. */
  frame: DecodedFrame | null;
  /** Screen-sized scratch layer the mask is composited on before drawing into the chassis. */
  screenLayer: OffscreenCanvas | null;
  /** Cached chassis artwork (rim + display band), rebuilt when the geometry key changes. */
  chassis: OffscreenCanvas | null;
  chassisKey: string;
}

export function createCompositorState(): CompositorState {
  return { mask: null, frame: null, screenLayer: null, chassis: null, chassisKey: '' };
}

const RIM_COLOR = '#3a3a3c';
const BEZEL_COLOR = '#000000';
/** Mask dilation samples — the offsets the screen shape is stamped along to grow the chassis. */
const DILATION_STAMPS = 24;

/** Paint the whole device into `canvas` (resizing it to the native device dimensions). No-op
 * until a frame has been set on `state`. */
export function paintDevice(canvas: HTMLCanvasElement, state: CompositorState): void {
  const frame = state.frame;
  if (frame === null) return;
  const screenW = frameWidth(frame);
  const screenH = frameHeight(frame);
  const pad = Math.round(screenW * PAD_FRACTION);
  const buttonDepth = Math.round(screenW * BUTTON_DEPTH_FRACTION);
  const width = screenW + 2 * pad + 2 * buttonDepth;
  const height = screenH + 2 * pad;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.clearRect(0, 0, width, height);

  // Side buttons first, so the chassis paints over their inner halves.
  context.fillStyle = RIM_COLOR;
  const buttonWidth = buttonDepth * 3;
  for (const [top, size] of LEFT_BUTTONS) {
    context.beginPath();
    context.roundRect(0, pad + top * screenH, buttonWidth, size * screenH, buttonDepth);
    context.fill();
  }
  for (const [top, size] of RIGHT_BUTTONS) {
    context.beginPath();
    context.roundRect(
      width - buttonWidth,
      pad + top * screenH,
      buttonWidth,
      size * screenH,
      buttonDepth,
    );
    context.fill();
  }

  context.drawImage(buildChassis(state, screenW, screenH), buttonDepth, 0);

  // Screen: composite the frame against the mask on a screen-sized layer, then inset it.
  let layer = state.screenLayer;
  if (layer?.width !== screenW || layer.height !== screenH) {
    layer = new OffscreenCanvas(screenW, screenH);
    state.screenLayer = layer;
  }
  const layerContext = layer.getContext('2d');
  if (layerContext === null) return;
  layerContext.clearRect(0, 0, layer.width, layer.height);
  if (state.mask === null) {
    layerContext.save();
    layerContext.beginPath();
    layerContext.roundRect(0, 0, layer.width, layer.height, screenW * FALLBACK_CORNER_FRACTION);
    layerContext.clip();
    layerContext.drawImage(frame, 0, 0);
    layerContext.restore();
  } else {
    layerContext.drawImage(frame, 0, 0);
    layerContext.globalCompositeOperation = 'destination-in';
    layerContext.drawImage(state.mask, 0, 0, layer.width, layer.height);
    layerContext.globalCompositeOperation = 'source-over';
  }
  context.drawImage(layer, buttonDepth + pad, pad);
}

/** The chassis artwork (rim + display band), cached per frame-size + mask identity. */
function buildChassis(state: CompositorState, screenW: number, screenH: number): OffscreenCanvas {
  const pad = Math.round(screenW * PAD_FRACTION);
  const rim = Math.round(screenW * RIM_FRACTION);
  const width = screenW + 2 * pad;
  const height = screenH + 2 * pad;
  const key = `${width}x${height}:${state.mask === null ? 'fallback' : 'mask'}`;
  if (state.chassis !== null && state.chassisKey === key) return state.chassis;

  const chassis = new OffscreenCanvas(width, height);
  const context = chassis.getContext('2d');
  if (context === null) return chassis;
  context.clearRect(0, 0, width, height);
  const rimShape = growScreenShape(state.mask, screenW, screenH, pad);
  const bandShape = growScreenShape(state.mask, screenW, screenH, pad - rim);
  colorize(rimShape, RIM_COLOR);
  colorize(bandShape, BEZEL_COLOR);
  context.drawImage(rimShape, 0, 0);
  context.drawImage(bandShape, rim, rim);
  state.chassis = chassis;
  state.chassisKey = key;
  return chassis;
}

/** The screen shape expanded outward by `grow` px: the mask stamped along a circle of offsets
 * (morphological dilation); a rounded rect when no mask exists. */
function growScreenShape(
  mask: ImageBitmap | null,
  screenW: number,
  screenH: number,
  grow: number,
): OffscreenCanvas {
  const shape = new OffscreenCanvas(screenW + 2 * grow, screenH + 2 * grow);
  const context = shape.getContext('2d');
  if (context === null) return shape;
  if (mask === null) {
    context.beginPath();
    context.roundRect(0, 0, shape.width, shape.height, screenW * FALLBACK_CORNER_FRACTION + grow);
    context.fill();
    return shape;
  }
  for (let step = 0; step < DILATION_STAMPS; step += 1) {
    const angle = (2 * Math.PI * step) / DILATION_STAMPS;
    context.drawImage(
      mask,
      grow + grow * Math.cos(angle),
      grow + grow * Math.sin(angle),
      screenW,
      screenH,
    );
  }
  return shape;
}

/** Replace every opaque pixel of `shape` with `color` in place. */
function colorize(shape: OffscreenCanvas, color: string): void {
  const context = shape.getContext('2d');
  if (context === null) return;
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, shape.width, shape.height);
  context.globalCompositeOperation = 'source-over';
}
