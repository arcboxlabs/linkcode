import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { clamp } from 'foxts/clamp';
import { noop } from 'foxts/noop';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import type { SimulatorKeyPress } from './keymap';
import { simulatorKeyPress } from './keymap';

export interface SimulatorScreenPoint {
  x: number;
  y: number;
}

/** One phase of a streamed touch gesture. */
export type SimulatorScreenTouchPhase = 'down' | 'move' | 'up';

/** Minimum interval between forwarded `move` phases (≈60 Hz). */
const TOUCH_MOVE_INTERVAL_MS = 16;
/** A wheel stream idle for this long ends its synthetic drag gesture. */
const WHEEL_IDLE_MS = 120;

// Chassis proportions as fractions of the native screen width, matched against Simulator.app's
// iPhone chrome: a thin black display band inside a titanium rim, with side-button bumps.
/** Screen edge → chassis outer edge (black band + rim). */
const PAD_FRACTION = 0.028;
/** The titanium band's thickness (outermost part of the pad). */
const RIM_FRACTION = 0.011;
/** How far the side buttons protrude beyond the chassis. */
const BUTTON_DEPTH_FRACTION = 0.009;
/** Side buttons as `[top, height]` fractions of the native screen height. */
const LEFT_BUTTONS: ReadonlyArray<readonly [number, number]> = [
  [0.245, 0.045],
  [0.315, 0.1],
  [0.425, 0.1],
];
const RIGHT_BUTTONS: ReadonlyArray<readonly [number, number]> = [[0.355, 0.175]];
/** Fallback screen corner radius (fraction of width) when the host has no mask to measure. */
const FALLBACK_CORNER_FRACTION = 0.11;

const RIM_COLOR = '#3a3a3c';
const BEZEL_COLOR = '#000000';

/** One stream frame: a base64 JPEG image, or one ordered base64 Annex-B H.264 access unit. */
export interface SimulatorScreenFrame {
  codec: 'jpeg' | 'h264';
  key: boolean;
  data: string;
}

export interface SimulatorScreenProps {
  /** Feed of stream frames; returns the unsubscribe. H.264 units decode through WebCodecs
   * (hardware, GPU-resident output); JPEG frames decode via `createImageBitmap`. */
  subscribeFrames: (onFrame: (frame: SimulatorScreenFrame) => void) => () => void;
  /** A streamed touch phase in normalized [0,1] device coordinates: exactly one `down`, any
   * number of `move`s, one final `up` per gesture. Forwarded in real time, so the device's own
   * gesture recognition decides tap vs drag vs long-press. */
  onTouch?: (phase: SimulatorScreenTouchPhase, point: SimulatorScreenPoint) => void;
  /** A key press (typed on the focused screen) decomposed to HID usages — see {@link simulatorKeyPress}. */
  onKey?: (press: SimulatorKeyPress) => void;
  /** The device's real screen-outline mask (image URL, framebuffer-sized): clips the stream to
   * the exact screen shape, and its measured corner radius keeps the chassis curve concentric.
   * Absent → a generic rounding. */
  maskUrl?: string | null;
  /** Shown centered until the first frame arrives. */
  placeholder?: React.ReactNode;
  className?: string;
}

/** A decoded frame the compositor can draw: a bitmap (JPEG path) or a GPU-resident VideoFrame
 * (H.264 path). Both close() and drawImage() uniformly; only the size accessors differ. */
type DecodedFrame = ImageBitmap | VideoFrame;

function frameWidth(frame: DecodedFrame): number {
  return 'displayWidth' in frame ? frame.displayWidth : frame.width;
}

function frameHeight(frame: DecodedFrame): number {
  return 'displayHeight' in frame ? frame.displayHeight : frame.height;
}

/** Everything the compositor knows about one device feed, in native framebuffer pixels. */
interface PaintState {
  mask: ImageBitmap | null;
  /** Last decoded frame, retained so a late-arriving mask can recomposite it. */
  frame: DecodedFrame | null;
  /** Screen-sized scratch layer the mask is composited on before drawing into the chassis. */
  screenLayer: OffscreenCanvas | null;
  /** Cached chassis artwork (rim + display band), rebuilt when the geometry key changes. */
  chassis: OffscreenCanvas | null;
  chassisKey: string;
}

/**
 * Live device screen composited like the real machine: the chassis (bezel band + concentric
 * outer corners) and the mask-clipped framebuffer are painted together in native pixel space,
 * so every proportion scales with the panel exactly. Latest-wins frame decode; pointer presses
 * map back to normalized tap/swipe callbacks. Key this component by device.
 */
export function SimulatorScreen({
  subscribeFrames,
  onTouch,
  onKey,
  maskUrl,
  placeholder,
  className,
}: SimulatorScreenProps): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef<PaintState>({
    mask: null,
    frame: null,
    screenLayer: null,
    chassis: null,
    chassisKey: '',
  });
  const pressRef = useRef<{
    pointerId: number;
    last: SimulatorScreenPoint;
    moveSentAt: number;
  } | null>(null);
  /** `w / h` of the whole painted device (screen + bezel); sizes the canvas box. */
  const [deviceAspect, setDeviceAspect] = useState<string | null>(null);

  useAbortableEffect(
    (signal) => {
      const state = paintRef.current;

      const adopt = (frame: DecodedFrame): void => {
        if (signal.aborted || canvasRef.current === null) {
          frame.close();
          return;
        }
        state.frame?.close();
        state.frame = frame;
        paintDevice(canvasRef.current, state);
        const canvas = canvasRef.current;
        const aspect = `${canvas.width} / ${canvas.height}`;
        setDeviceAspect((previous) => (previous === aspect ? previous : aspect));
      };

      // JPEG path: latest-wins decode via createImageBitmap.
      let latestJpeg: string | null = null;
      let decoding = false;
      const drawNextJpeg = (): void => {
        if (decoding || latestJpeg === null || signal.aborted) return;
        const encoded = latestJpeg;
        latestJpeg = null;
        decoding = true;
        void createImageBitmap(new Blob([base64Bytes(encoded)], { type: 'image/jpeg' }))
          .then(adopt)
          // A corrupt frame is dropped; the next one repaints.
          .catch(noop)
          .finally(() => {
            decoding = false;
            drawNextJpeg();
          });
      };

      // H.264 path: hardware decode via WebCodecs; output VideoFrames stay GPU-resident. The
      // decoder configures lazily, consumes only from a keyframe, and resets (waiting for the
      // next key, ≤2s away) on any decode error.
      let decoder: VideoDecoder | null = null;
      let awaitingKey = true;
      let timestamp = 0;
      const resetDecoder = (): void => {
        if (decoder !== null && decoder.state !== 'closed') decoder.close();
        decoder = null;
        awaitingKey = true;
      };
      const decodeH264 = (frame: SimulatorScreenFrame): void => {
        if (decoder === null) {
          const created = new VideoDecoder({
            output: adopt,
            error: resetDecoder,
          });
          // High profile at a level comfortably above any simulator resolution; the in-band
          // SPS/PPS on each keyframe governs the actual stream parameters.
          created.configure({ codec: 'avc1.640034', optimizeForLatency: true });
          decoder = created;
          awaitingKey = true;
        }
        if (awaitingKey && !frame.key) return;
        awaitingKey = false;
        decoder.decode(
          new EncodedVideoChunk({
            type: frame.key ? 'key' : 'delta',
            // Synthetic monotonic clock; frames present as they arrive, so only order matters.
            timestamp: timestamp++,
            data: base64Bytes(frame.data),
          }),
        );
      };

      const unsubscribe = subscribeFrames((frame) => {
        if (frame.codec === 'h264') {
          decodeH264(frame);
          return;
        }
        // A JPEG frame amid an h264 stream means the host degraded; drop the decoder.
        resetDecoder();
        latestJpeg = frame.data;
        drawNextJpeg();
      });
      return () => {
        unsubscribe();
        resetDecoder();
        state.frame?.close();
        state.frame = null;
      };
    },
    [subscribeFrames],
  );

  useAbortableEffect(
    (signal) => {
      if (maskUrl == null) return;
      const state = paintRef.current;
      void fetch(maskUrl, { signal })
        .then(decodeResponse)
        .then((bitmap) => {
          if (signal.aborted) {
            bitmap.close();
            return;
          }
          state.mask?.close();
          state.mask = bitmap;
          // Recomposite the held frame so the mask applies without waiting for the next one.
          if (canvasRef.current !== null && state.frame !== null) {
            paintDevice(canvasRef.current, state);
          }
        })
        .catch(noop);
      return () => {
        state.mask?.close();
        state.mask = null;
      };
    },
    [maskUrl],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPoint(event);
    pressRef.current = { pointerId: event.pointerId, last: point, moveSentAt: performance.now() };
    onTouch?.('down', point);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    const now = performance.now();
    if (now - press.moveSentAt < TOUCH_MOVE_INTERVAL_MS) return;
    const point = normalizedPoint(event);
    press.last = point;
    press.moveSentAt = now;
    onTouch?.('move', point);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    pressRef.current = null;
    onTouch?.('up', normalizedPoint(event));
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    pressRef.current = null;
    // End the gesture where it last was — a stuck touch would keep the device pressed forever.
    onTouch?.('up', press.last);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    if (onKey === undefined || event.nativeEvent.isComposing) return;
    const press = simulatorKeyPress(event);
    if (press === null) return;
    event.preventDefault();
    onKey(press);
  };

  // Trackpad/wheel scrolling becomes a synthetic drag: touch down where the cursor sits, move
  // opposite the scroll deltas (finger-follows-content, like the real device), up after idle.
  const wheelRef = useRef<{
    pos: SimulatorScreenPoint;
    endTimer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    if (pressRef.current !== null) return;
    const screen = screenRectOnPage(event.currentTarget);
    const endGesture = (): void => {
      const wheel = wheelRef.current;
      wheelRef.current = null;
      if (wheel) onTouch?.('up', wheel.pos);
    };
    let wheel = wheelRef.current;
    if (wheel === null) {
      const start = normalizedPoint(event);
      wheel = { pos: start, endTimer: setTimeout(endGesture, WHEEL_IDLE_MS) };
      wheelRef.current = wheel;
      onTouch?.('down', start);
    } else {
      clearTimeout(wheel.endTimer);
      wheel.endTimer = setTimeout(endGesture, WHEEL_IDLE_MS);
    }
    wheel.pos = {
      x: clamp(wheel.pos.x - event.deltaX / screen.width, 0, 1),
      y: clamp(wheel.pos.y - event.deltaY / screen.height, 0, 1),
    };
    onTouch?.('move', wheel.pos);
  };

  return (
    <div
      className={cn('flex h-full w-full items-center justify-center overflow-hidden', className)}
    >
      {/* Focusable so plain typing reaches the device; app-level chords (⌘…) pass through. */}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        className={cn(
          'w-full max-h-full max-w-full touch-none object-contain outline-none drop-shadow-xl',
          deviceAspect === null && 'hidden',
        )}
        style={deviceAspect === null ? undefined : { aspectRatio: deviceAspect }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      />
      {deviceAspect === null && placeholder}
    </div>
  );
}

/** Paint the whole device in native pixels: side-button bumps, then the cached chassis (rim +
 * display band, both grown from the real mask so the band stays even around the corners), then
 * the mask-clipped frame. */
function paintDevice(canvas: HTMLCanvasElement, state: PaintState): void {
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

/**
 * The chassis artwork: the titanium rim and the black display band, built by morphologically
 * dilating the real screen mask (stamping it along a circle of offsets). Growing the true shape
 * keeps the band width even the whole way around the corner and the outer curvature in the same
 * family as Apple's continuous-curvature screen corners — a `roundRect`'s circular arcs visibly
 * diverge from them. Cached per frame-size + mask identity; without a mask a rounded rect stands
 * in for the shape.
 */
function buildChassis(state: PaintState, screenW: number, screenH: number): OffscreenCanvas {
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
  const STAMPS = 24;
  for (let step = 0; step < STAMPS; step += 1) {
    const angle = (2 * Math.PI * step) / STAMPS;
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

/** The painted device's on-page box (the canvas is `object-contain`, so it may be letterboxed). */
function deviceRectOnPage(canvas: HTMLCanvasElement): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
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
function screenRectOnPage(canvas: HTMLCanvasElement): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
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

function normalizedPoint(event: {
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

function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.codePointAt(index) ?? 0;
  }
  return bytes;
}

function decodeResponse(response: Response): Promise<ImageBitmap> {
  return response.blob().then((blob) => createImageBitmap(blob));
}
