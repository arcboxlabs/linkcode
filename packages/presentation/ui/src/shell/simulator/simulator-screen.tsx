import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { clamp } from 'foxts/clamp';
import { noop } from 'foxts/noop';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { createCompositorState, paintDevice } from './device-compositor';
import type { SimulatorScreenPoint } from './device-geometry';
import { mirrorPoint, normalizedPoint, screenRectOnPage } from './device-geometry';
import type { SimulatorScreenFrame } from './frame-decoder';
import { decodeMask, SimulatorFrameDecoder } from './frame-decoder';
import type { SimulatorKeyPress } from './keymap';
import { simulatorKeyPress } from './keymap';

export type { SimulatorScreenPoint } from './device-geometry';
export type { SimulatorScreenFrame } from './frame-decoder';

/** One phase of a streamed touch gesture. */
export type SimulatorScreenTouchPhase = 'down' | 'move' | 'up';

/** Minimum interval between forwarded `move` phases (≈60 Hz). */
const TOUCH_MOVE_INTERVAL_MS = 16;
/** A wheel stream idle for this long ends its synthetic drag gesture. */
const WHEEL_IDLE_MS = 120;

export interface SimulatorScreenProps {
  /** Feed of stream frames; returns the unsubscribe. H.264 units decode through WebCodecs
   * (hardware, GPU-resident output); JPEG frames decode via `createImageBitmap`. */
  subscribeFrames: (onFrame: (frame: SimulatorScreenFrame) => void) => () => void;
  /** A streamed touch phase in normalized [0,1] device coordinates: exactly one `down`, any
   * number of `move`s, one final `up` per gesture. Forwarded in real time, so the device's own
   * gesture recognition decides tap vs drag vs long-press. */
  onTouch?: (phase: SimulatorScreenTouchPhase, point: SimulatorScreenPoint) => void;
  /** A streamed two-finger phase (pinch/zoom): both fingers in normalized coordinates. Driven by
   * Option-drag, mirroring Simulator.app — the two fingers are symmetric about the drag origin. */
  onPinch?: (
    phase: SimulatorScreenTouchPhase,
    a: SimulatorScreenPoint,
    b: SimulatorScreenPoint,
  ) => void;
  /** A key press (typed on the focused screen) decomposed to HID usages — see {@link simulatorKeyPress}. */
  onKey?: (press: SimulatorKeyPress) => void;
  /** Text committed by the OS IME (composition end / non-ASCII input): pasted onto the device. */
  onText?: (text: string) => void;
  /** The device's real screen-outline mask (image URL, framebuffer-sized): clips the stream to
   * the exact screen shape, and its measured corner radius keeps the chassis curve concentric.
   * Absent → a generic rounding. */
  maskUrl?: string | null;
  /** Shown centered until the first frame arrives. */
  placeholder?: React.ReactNode;
  className?: string;
}

/**
 * Live device screen: renders the framebuffer stream as the whole machine (chassis + mask-clipped
 * screen) and forwards pointer/wheel/key input as normalized gestures. The decode, compositing,
 * and coordinate mapping are framework-agnostic modules ({@link SimulatorFrameDecoder},
 * {@link paintDevice}, `device-geometry`); this component only wires them to React and the DOM.
 * Key it by device so a switch resets the painted frame.
 */
export function SimulatorScreen({
  subscribeFrames,
  onTouch,
  onPinch,
  onKey,
  onText,
  maskUrl,
  placeholder,
  className,
}: SimulatorScreenProps): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const compositorRef = useRef(createCompositorState());
  const pressRef = useRef<{
    pointerId: number;
    /** True while this drag is an Option-pinch (two mirrored fingers about `origin`). */
    pinch: boolean;
    origin: SimulatorScreenPoint;
    last: SimulatorScreenPoint;
    moveSentAt: number;
  } | null>(null);
  /** `w / h` of the whole painted device (screen + bezel); sizes the canvas box. */
  const [deviceAspect, setDeviceAspect] = useState<string | null>(null);

  useAbortableEffect(
    (signal) => {
      const state = compositorRef.current;
      const decoder = new SimulatorFrameDecoder((frame) => {
        if (signal.aborted || canvasRef.current === null) {
          frame.close();
          return;
        }
        state.frame?.close();
        state.frame = frame;
        paintDevice(canvasRef.current, state);
        const aspect = `${canvasRef.current.width} / ${canvasRef.current.height}`;
        setDeviceAspect((previous) => (previous === aspect ? previous : aspect));
      });
      const unsubscribe = subscribeFrames((frame) => decoder.push(frame));
      return () => {
        unsubscribe();
        decoder.close();
        state.frame?.close();
        state.frame = null;
      };
    },
    [subscribeFrames],
  );

  useAbortableEffect(
    (signal) => {
      if (maskUrl == null) return;
      const state = compositorRef.current;
      void fetch(maskUrl, { signal })
        .then(decodeMask)
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

  const emitGesture = (phase: SimulatorScreenTouchPhase, point: SimulatorScreenPoint): void => {
    const press = pressRef.current;
    if (press?.pinch) onPinch?.(phase, point, mirrorPoint(press.origin, point));
    else onTouch?.(phase, point);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    inputRef.current?.focus({ preventScroll: true });
    const point = normalizedPoint(event);
    pressRef.current = {
      pointerId: event.pointerId,
      pinch: event.altKey && onPinch !== undefined,
      origin: point,
      last: point,
      moveSentAt: performance.now(),
    };
    emitGesture('down', point);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    const now = performance.now();
    if (now - press.moveSentAt < TOUCH_MOVE_INTERVAL_MS) return;
    const point = normalizedPoint(event);
    press.last = point;
    press.moveSentAt = now;
    emitGesture('move', point);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    emitGesture('up', normalizedPoint(event));
    pressRef.current = null;
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const press = pressRef.current;
    if (press?.pointerId !== event.pointerId) return;
    // End the gesture where it last was — a stuck touch would keep the device pressed forever.
    emitGesture('up', press.last);
    pressRef.current = null;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (onKey === undefined || event.nativeEvent.isComposing) return;
    const press = simulatorKeyPress(event);
    if (press === null) return;
    event.preventDefault();
    onKey(press);
  };

  // IME / non-ASCII commits arrive here (the hidden input is where composition happens). Route
  // them through the pasteboard; clear the input so it never accumulates.
  const handleInput = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.currentTarget.value;
    event.currentTarget.value = '';
    if (value.length > 0) onText?.(value);
  };

  // Trackpad/wheel scrolling becomes a synthetic drag: touch down where the cursor sits, move
  // opposite the scroll deltas (finger-follows-content), up after idle. Trackpad wheels fire far
  // faster than 60 Hz, so deltas accumulate into `pos` every event but a `move` is emitted at most
  // once per frame — the final `up` carries the settled position so nothing is lost.
  const wheelRef = useRef<{
    pos: SimulatorScreenPoint;
    moveSentAt: number;
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
    const now = performance.now();
    let wheel = wheelRef.current;
    if (wheel === null) {
      const start = normalizedPoint(event);
      const endTimer = setTimeout(endGesture, WHEEL_IDLE_MS);
      wheel = { pos: start, moveSentAt: now, endTimer };
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
    if (now - wheel.moveSentAt >= TOUCH_MOVE_INTERVAL_MS) {
      wheel.moveSentAt = now;
      onTouch?.('move', wheel.pos);
    }
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
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
      />
      {/* Off-screen editable that owns keyboard focus: ASCII keydowns become HID key presses,
          IME/non-ASCII commits become pasteboard text. A tap on the canvas focuses it. App-level
          chords (⌘…) fall through `simulatorKeyPress` untouched. */}
      <input
        ref={inputRef}
        aria-label="Simulator keyboard input"
        className="pointer-events-none absolute size-0 opacity-0"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={handleKeyDown}
        onChange={handleInput}
      />
      {deviceAspect === null && placeholder}
    </div>
  );
}
