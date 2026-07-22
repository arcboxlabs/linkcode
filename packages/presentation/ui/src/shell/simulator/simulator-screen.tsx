import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { clamp } from 'foxts/clamp';
import { noop } from 'foxts/noop';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface SimulatorScreenPoint {
  x: number;
  y: number;
}

/** Below this pointer travel (in element px) a press counts as a tap, not a swipe. */
const SWIPE_THRESHOLD_PX = 8;

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

export interface SimulatorScreenProps {
  /** Feed of JPEG frames (base64, no data-URL prefix); returns the unsubscribe. */
  subscribeFrames: (onFrame: (jpegBase64: string) => void) => () => void;
  /** Press in normalized [0,1] device coordinates. */
  onTap?: (point: SimulatorScreenPoint) => void;
  /** Drag in normalized [0,1] device coordinates with its real duration. */
  onSwipe?: (from: SimulatorScreenPoint, to: SimulatorScreenPoint, durationMs: number) => void;
  /** The device's real screen-outline mask (image URL, framebuffer-sized): clips the stream to
   * the exact screen shape, and its measured corner radius keeps the chassis curve concentric.
   * Absent → a generic rounding. */
  maskUrl?: string | null;
  /** Shown centered until the first frame arrives. */
  placeholder?: React.ReactNode;
  className?: string;
}

/** Everything the compositor knows about one device feed, in native framebuffer pixels. */
interface PaintState {
  mask: ImageBitmap | null;
  /** Screen corner radius measured from the mask's alpha (native px); null until measured. */
  cornerRadius: number | null;
  /** Last decoded frame, retained so a late-arriving mask can recomposite it. */
  frame: ImageBitmap | null;
  /** Screen-sized scratch layer the mask is composited on before drawing into the chassis. */
  screenLayer: OffscreenCanvas | null;
}

/**
 * Live device screen composited like the real machine: the chassis (bezel band + concentric
 * outer corners) and the mask-clipped framebuffer are painted together in native pixel space,
 * so every proportion scales with the panel exactly. Latest-wins frame decode; pointer presses
 * map back to normalized tap/swipe callbacks. Key this component by device.
 */
export function SimulatorScreen({
  subscribeFrames,
  onTap,
  onSwipe,
  maskUrl,
  placeholder,
  className,
}: SimulatorScreenProps): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef<PaintState>({
    mask: null,
    cornerRadius: null,
    frame: null,
    screenLayer: null,
  });
  const pressRef = useRef<{ pointerId: number; start: SimulatorScreenPoint; at: number } | null>(
    null,
  );
  /** `w / h` of the whole painted device (screen + bezel); sizes the canvas box. */
  const [deviceAspect, setDeviceAspect] = useState<string | null>(null);

  useAbortableEffect(
    (signal) => {
      const state = paintRef.current;
      let latest: string | null = null;
      let decoding = false;
      const drawNext = (): void => {
        if (decoding || latest === null || signal.aborted) return;
        const encoded = latest;
        latest = null;
        decoding = true;
        void createImageBitmap(new Blob([base64Bytes(encoded)], { type: 'image/jpeg' }))
          .then((bitmap) => {
            if (signal.aborted || canvasRef.current === null) {
              bitmap.close();
              return;
            }
            state.frame?.close();
            state.frame = bitmap;
            paintDevice(canvasRef.current, state);
            const canvas = canvasRef.current;
            const aspect = `${canvas.width} / ${canvas.height}`;
            setDeviceAspect((previous) => (previous === aspect ? previous : aspect));
          })
          // A corrupt frame is dropped; the next one repaints.
          .catch(noop)
          .finally(() => {
            decoding = false;
            drawNext();
          });
      };
      const unsubscribe = subscribeFrames((frame) => {
        latest = frame;
        drawNext();
      });
      return () => {
        unsubscribe();
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
          state.cornerRadius = measureCornerRadius(bitmap);
          // Recomposite the held frame so the mask applies without waiting for the next one.
          if (canvasRef.current !== null && state.frame !== null) {
            paintDevice(canvasRef.current, state);
          }
        })
        .catch(noop);
      return () => {
        state.mask?.close();
        state.mask = null;
        state.cornerRadius = null;
      };
    },
    [maskUrl],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = {
      pointerId: event.pointerId,
      start: normalizedPoint(event),
      at: performance.now(),
    };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    pressRef.current = null;
    const end = normalizedPoint(event);
    const screen = screenRectOnPage(event.currentTarget);
    const travelPx = Math.hypot(
      (end.x - press.start.x) * screen.width,
      (end.y - press.start.y) * screen.height,
    );
    if (travelPx < SWIPE_THRESHOLD_PX) onTap?.(end);
    else onSwipe?.(press.start, end, Math.round(performance.now() - press.at));
  };

  return (
    <div
      className={cn('flex h-full w-full items-center justify-center overflow-hidden', className)}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          'w-full max-h-full max-w-full touch-none object-contain drop-shadow-xl',
          deviceAspect === null && 'hidden',
        )}
        style={deviceAspect === null ? undefined : { aspectRatio: deviceAspect }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pressRef.current = null;
        }}
      />
      {deviceAspect === null && placeholder}
    </div>
  );
}

/** Paint the whole device in native pixels: titanium rim, black display band, side-button bumps,
 * then the mask-clipped frame. The chassis corners stay concentric with the screen corners. */
function paintDevice(canvas: HTMLCanvasElement, state: PaintState): void {
  const frame = state.frame;
  if (frame === null) return;
  const pad = Math.round(frame.width * PAD_FRACTION);
  const rim = Math.round(frame.width * RIM_FRACTION);
  const buttonDepth = Math.round(frame.width * BUTTON_DEPTH_FRACTION);
  const width = frame.width + 2 * pad + 2 * buttonDepth;
  const height = frame.height + 2 * pad;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (context === null) return;

  const screenRadius = state.cornerRadius ?? frame.width * FALLBACK_CORNER_FRACTION;
  context.clearRect(0, 0, width, height);

  // Side buttons first, so the chassis paints over their inner halves.
  context.fillStyle = RIM_COLOR;
  const buttonWidth = buttonDepth * 3;
  for (const [top, size] of LEFT_BUTTONS) {
    context.beginPath();
    context.roundRect(0, pad + top * frame.height, buttonWidth, size * frame.height, buttonDepth);
    context.fill();
  }
  for (const [top, size] of RIGHT_BUTTONS) {
    context.beginPath();
    context.roundRect(
      width - buttonWidth,
      pad + top * frame.height,
      buttonWidth,
      size * frame.height,
      buttonDepth,
    );
    context.fill();
  }

  // Titanium rim, then the black display band inside it — both concentric with the screen.
  context.beginPath();
  context.roundRect(buttonDepth, 0, width - 2 * buttonDepth, height, screenRadius + pad);
  context.fillStyle = RIM_COLOR;
  context.fill();
  context.beginPath();
  context.roundRect(
    buttonDepth + rim,
    rim,
    width - 2 * buttonDepth - 2 * rim,
    height - 2 * rim,
    screenRadius + pad - rim,
  );
  context.fillStyle = BEZEL_COLOR;
  context.fill();

  // Screen: composite the frame against the mask on a screen-sized layer, then inset it.
  let layer = state.screenLayer;
  if (layer?.width !== frame.width || layer.height !== frame.height) {
    layer = new OffscreenCanvas(frame.width, frame.height);
    state.screenLayer = layer;
  }
  const layerContext = layer.getContext('2d');
  if (layerContext === null) return;
  layerContext.clearRect(0, 0, layer.width, layer.height);
  if (state.mask === null) {
    layerContext.save();
    layerContext.beginPath();
    layerContext.roundRect(0, 0, layer.width, layer.height, screenRadius);
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

/** First fully-opaque row along the mask's left edge = the screen's corner radius (native px). */
function measureCornerRadius(mask: ImageBitmap): number | null {
  const probe = new OffscreenCanvas(1, mask.height);
  const context = probe.getContext('2d');
  if (context === null) return null;
  context.drawImage(mask, 0, 0);
  const alpha = context.getImageData(0, 0, 1, mask.height).data;
  for (let y = 0; y < mask.height; y += 1) {
    if (alpha[y * 4 + 3] > 127) return y;
  }
  return null;
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

function normalizedPoint(event: React.PointerEvent<HTMLCanvasElement>): SimulatorScreenPoint {
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
