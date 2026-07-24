import { useEffect } from 'foxact/use-abortable-effect';
import { clamp } from 'foxts/clamp';
import { noop } from 'foxts/noop';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import type { DecodedFrame } from './device-compositor';
import { frameHeight, frameWidth, paintChassis, paintScreen } from './device-compositor';
import type { ScreenInset, SimulatorScreenPoint } from './device-geometry';
import { mirrorPoint, normalizedPoint, screenInset } from './device-geometry';
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
/** When a re-planted wheel finger lands, it re-plants inside this band (a real long scroll is many
 * swipes; a finger clamped at the edge just stalls). Kept clear of the top/bottom edges so an
 * upward re-swipe never reads as the home gesture. */
const WHEEL_BAND_LO = 0.15;
const WHEEL_BAND_HI = 0.85;
/** How far, in normalized units, a re-planted finger is nudged so the touch reads as a drag (not a
 * stray tap if the scroll idles right after re-planting). */
const WHEEL_NUDGE = 0.02;

/** The device box's size + the screen layer's placement within it, once the first frame reveals
 * the framebuffer dimensions. */
interface DeviceLayout {
  deviceW: number;
  deviceH: number;
  inset: ScreenInset;
}

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
  /** The device's real screen-outline mask as a base64-encoded PNG (framebuffer-sized): clips the
   * stream to the exact screen shape, and its grown outline keeps the chassis band even. Absent → a
   * generic rounding. Base64, not a `data:` URL — the desktop CSP blocks `fetch`-ing data URLs. */
  maskPng?: string | null;
  /** Shown centered until the first frame arrives. */
  placeholder?: React.ReactNode;
  className?: string;
}

/**
 * Live device screen, rendered as two DOM layers so 60 fps stays cheap: a chassis canvas painted
 * once ({@link paintChassis}) and a screen canvas painted every frame ({@link paintScreen}) with
 * only a frame draw + a mask composite — no static artwork repaints. Decode ({@link
 * SimulatorFrameDecoder}) and coordinate mapping (`device-geometry`) are framework-agnostic; this
 * component wires them to React, vsync-aligns paints with `requestAnimationFrame`, and forwards
 * pointer/wheel/key input as normalized gestures. Key it by device so a switch resets the frame.
 */
export function SimulatorScreen({
  subscribeFrames,
  onTouch,
  onPinch,
  onKey,
  onText,
  maskPng,
  placeholder,
  className,
}: SimulatorScreenProps): React.ReactNode {
  const chassisRef = useRef<HTMLCanvasElement | null>(null);
  const screenRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Latest decoded frame, retained so a late mask (or the next rAF) can recomposite it. */
  const frameRef = useRef<DecodedFrame | null>(null);
  const maskRef = useRef<ImageBitmap | null>(null);
  /** Coalesce paints onto the display's refresh: the decoder can outrun it, so only the newest
   * frame is drawn each tick. Set by the decoder effect; the mask effect calls it to recomposite. */
  const repaintRef = useRef<() => void>(noop);
  const pressRef = useRef<{
    pointerId: number;
    /** True while this drag is an Option-pinch (two mirrored fingers about `origin`). */
    pinch: boolean;
    origin: SimulatorScreenPoint;
    last: SimulatorScreenPoint;
    moveSentAt: number;
  } | null>(null);
  const [layout, setLayout] = useState<DeviceLayout | null>(null);

  useEffect(
    (signal) => {
      let rafId: number | null = null;
      // Rebuilt only when the framebuffer size or mask presence changes — i.e. essentially once.
      let chassisKey = '';
      const paint = (): void => {
        rafId = null;
        const frame = frameRef.current;
        const chassis = chassisRef.current;
        const screen = screenRef.current;
        if (frame === null || chassis === null || screen === null) return;
        const screenW = frameWidth(frame);
        const screenH = frameHeight(frame);
        const key = `${screenW}x${screenH}:${maskRef.current === null ? 'fallback' : 'mask'}`;
        if (key !== chassisKey) {
          chassisKey = key;
          paintChassis(chassis, maskRef.current, screenW, screenH);
          setLayout({
            deviceW: chassis.width,
            deviceH: chassis.height,
            inset: screenInset(screenW, screenH),
          });
        }
        paintScreen(screen, frame, maskRef.current);
      };
      const schedulePaint = (): void => {
        if (rafId === null) rafId = requestAnimationFrame(paint);
      };
      repaintRef.current = schedulePaint;

      const decoder = new SimulatorFrameDecoder((frame) => {
        if (signal.aborted) {
          frame.close();
          return;
        }
        frameRef.current?.close();
        frameRef.current = frame;
        schedulePaint();
      });
      const unsubscribe = subscribeFrames((frame) => decoder.push(frame));
      return () => {
        unsubscribe();
        decoder.close();
        if (rafId !== null) cancelAnimationFrame(rafId);
        repaintRef.current = noop;
        frameRef.current?.close();
        frameRef.current = null;
      };
    },
    [subscribeFrames],
  );

  useEffect(
    (signal) => {
      if (maskPng == null) return;
      void decodeMask(maskPng)
        .then((bitmap) => {
          if (signal.aborted) {
            bitmap.close();
            return;
          }
          maskRef.current?.close();
          maskRef.current = bitmap;
          // Recomposite the held frame so the mask applies without waiting for the next one.
          repaintRef.current();
        })
        .catch(noop);
      return () => {
        maskRef.current?.close();
        maskRef.current = null;
      };
    },
    [maskPng],
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
  // once per frame — the final `up` carries the settled position so nothing is lost. When the
  // finger would run off a screen edge, it lifts and re-plants on the far side, so one long scroll
  // becomes many swipes instead of a finger pinned at the edge (which stalls scrolling mid-page).
  const wheelRef = useRef<{
    pos: SimulatorScreenPoint;
    moveSentAt: number;
    endTimer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    if (pressRef.current !== null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const endGesture = (): void => {
      const wheel = wheelRef.current;
      wheelRef.current = null;
      if (wheel) onTouch?.('up', wheel.pos);
    };
    const now = performance.now();
    let wheel = wheelRef.current;
    if (wheel === null) {
      const cursor = normalizedPoint(event);
      const start = {
        x: clamp(cursor.x, WHEEL_BAND_LO, WHEEL_BAND_HI),
        y: clamp(cursor.y, WHEEL_BAND_LO, WHEEL_BAND_HI),
      };
      const endTimer = setTimeout(endGesture, WHEEL_IDLE_MS);
      wheel = { pos: start, moveSentAt: now, endTimer };
      wheelRef.current = wheel;
      onTouch?.('down', start);
    } else {
      clearTimeout(wheel.endTimer);
      wheel.endTimer = setTimeout(endGesture, WHEEL_IDLE_MS);
    }
    // Advance the synthetic finger opposite the scroll (finger follows content).
    const x = wheel.pos.x - event.deltaX / rect.width;
    const y = wheel.pos.y - event.deltaY / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      // Ran past a screen edge: finish this swipe there, lift, then re-plant on the far side so the
      // same scroll keeps dragging. The immediate nudge makes the re-planted touch a drag, so an
      // idle right after re-planting ends a swipe (up), never a stray tap in place.
      const edge = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
      onTouch?.('move', edge);
      onTouch?.('up', edge);
      const planted = {
        x: x < 0 ? WHEEL_BAND_HI : x > 1 ? WHEEL_BAND_LO : clamp(x, WHEEL_BAND_LO, WHEEL_BAND_HI),
        y: y < 0 ? WHEEL_BAND_HI : y > 1 ? WHEEL_BAND_LO : clamp(y, WHEEL_BAND_LO, WHEEL_BAND_HI),
      };
      onTouch?.('down', planted);
      const nudged = {
        x: clamp(planted.x - Math.sign(event.deltaX) * WHEEL_NUDGE, 0, 1),
        y: clamp(planted.y - Math.sign(event.deltaY) * WHEEL_NUDGE, 0, 1),
      };
      onTouch?.('move', nudged);
      wheel.pos = nudged;
      wheel.moveSentAt = now;
    } else {
      wheel.pos = { x, y };
      if (now - wheel.moveSentAt >= TOUCH_MOVE_INTERVAL_MS) {
        wheel.moveSentAt = now;
        onTouch?.('move', wheel.pos);
      }
    }
  };

  return (
    <div
      className={cn('flex h-full w-full items-center justify-center overflow-hidden', className)}
      // A size container so the device box can `object-contain` against the panel via cq units,
      // with no per-resize JS measuring.
      style={{ containerType: 'size' }}
    >
      <div
        className={cn('relative max-h-full max-w-full drop-shadow-xl', layout === null && 'hidden')}
        style={
          layout === null
            ? undefined
            : {
                aspectRatio: `${layout.deviceW} / ${layout.deviceH}`,
                width: `min(100cqw, calc(${layout.deviceW / layout.deviceH} * 100cqh))`,
              }
        }
      >
        <canvas ref={chassisRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <canvas
          ref={screenRef}
          className="absolute touch-none"
          style={
            layout === null
              ? undefined
              : {
                  left: `${layout.inset.left * 100}%`,
                  top: `${layout.inset.top * 100}%`,
                  width: `${layout.inset.width * 100}%`,
                  height: `${layout.inset.height * 100}%`,
                }
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
        />
      </div>
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
      {layout === null && placeholder}
    </div>
  );
}
