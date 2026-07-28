/**
 * The device compositor: draws the two layers of the machine. The chassis (side-button bumps + a
 * titanium rim + black display band grown from the real screen mask, so the band stays even around
 * the continuous-curvature corners a `roundRect` can't match) is static — painted once per device
 * via {@link paintChassis}. The screen is a separate layer painted every frame by
 * {@link paintScreen}: just the framebuffer clipped to the mask, so the per-frame cost is one draw
 * plus one mask composite and nothing static repaints. Pure canvas work; the component owns the
 * two canvases and the retained frame/mask.
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

const RIM_COLOR = '#3a3a3c';
const BEZEL_COLOR = '#000000';
/** Mask dilation samples — the offsets the screen shape is stamped along to grow the chassis. */
const DILATION_STAMPS = 24;

/** Paint the static chassis (buttons + rim + band) into `canvas`, resizing it to the whole device.
 * Called once per device and again only when the mask arrives — never per frame. */
export function paintChassis(
  canvas: HTMLCanvasElement,
  mask: ImageBitmap | null,
  screenW: number,
  screenH: number,
): void {
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

  context.drawImage(buildChassis(mask, screenW, screenH), buttonDepth, 0);
}

/** Paint one framebuffer frame into the screen layer, clipped to the real screen shape. This is
 * the entire per-frame cost: one opaque draw of the frame, then one mask composite that re-cuts
 * the rounded corners the opaque frame overwrote. The canvas is the exact screen size, so it never
 * needs clearing on the mask path. */
export function paintScreen(
  canvas: HTMLCanvasElement,
  frame: DecodedFrame,
  mask: ImageBitmap | null,
): void {
  const screenW = frameWidth(frame);
  const screenH = frameHeight(frame);
  if (canvas.width !== screenW || canvas.height !== screenH) {
    canvas.width = screenW;
    canvas.height = screenH;
  }
  const context = canvas.getContext('2d');
  if (context === null) return;
  if (mask === null) {
    context.clearRect(0, 0, screenW, screenH);
    context.save();
    context.beginPath();
    context.roundRect(0, 0, screenW, screenH, screenW * FALLBACK_CORNER_FRACTION);
    context.clip();
    context.drawImage(frame, 0, 0);
    context.restore();
  } else {
    context.globalCompositeOperation = 'source-over';
    context.drawImage(frame, 0, 0);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(mask, 0, 0, screenW, screenH);
    context.globalCompositeOperation = 'source-over';
  }
}

/** The chassis artwork (rim + display band) as a screen-plus-pad-sized layer. */
function buildChassis(mask: ImageBitmap | null, screenW: number, screenH: number): OffscreenCanvas {
  const pad = Math.round(screenW * PAD_FRACTION);
  const rim = Math.round(screenW * RIM_FRACTION);
  const width = screenW + 2 * pad;
  const height = screenH + 2 * pad;
  const chassis = new OffscreenCanvas(width, height);
  const context = chassis.getContext('2d');
  if (context !== null) {
    const rimShape = growScreenShape(mask, screenW, screenH, pad);
    const bandShape = growScreenShape(mask, screenW, screenH, pad - rim);
    colorize(rimShape, RIM_COLOR);
    colorize(bandShape, BEZEL_COLOR);
    context.drawImage(rimShape, 0, 0);
    context.drawImage(bandShape, rim, rim);
  }
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
