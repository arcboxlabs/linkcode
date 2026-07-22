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

export interface SimulatorScreenProps {
  /** Feed of JPEG frames (base64, no data-URL prefix); returns the unsubscribe. */
  subscribeFrames: (onFrame: (jpegBase64: string) => void) => () => void;
  /** Press in normalized [0,1] device coordinates. */
  onTap?: (point: SimulatorScreenPoint) => void;
  /** Drag in normalized [0,1] device coordinates with its real duration. */
  onSwipe?: (from: SimulatorScreenPoint, to: SimulatorScreenPoint, durationMs: number) => void;
  /** Shown centered until the first frame arrives. */
  placeholder?: React.ReactNode;
  className?: string;
}

/**
 * Live device screen: paints an MJPEG-style frame feed onto a canvas (latest-wins — a frame
 * arriving while the previous one decodes replaces it) and maps pointer presses back to
 * normalized tap/swipe callbacks. Pure presentation: the feed and the input sinks are props.
 * Key this component by device so a device switch resets the painted frame.
 */
export function SimulatorScreen({
  subscribeFrames,
  onTap,
  onSwipe,
  placeholder,
  className,
}: SimulatorScreenProps): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pressRef = useRef<{ pointerId: number; start: SimulatorScreenPoint; at: number } | null>(
    null,
  );
  /** `w / h` of the latest frame; sizes the bezel box so the screen fits without letterboxing. */
  const [frameAspect, setFrameAspect] = useState<string | null>(null);

  useAbortableEffect(
    (signal) => {
      let latest: string | null = null;
      let decoding = false;
      const drawNext = (): void => {
        if (decoding || latest === null || signal.aborted) return;
        const frame = latest;
        latest = null;
        decoding = true;
        void decodeJpegFrame(frame)
          .then((bitmap) => {
            const canvas = canvasRef.current;
            if (signal.aborted || canvas === null) {
              bitmap.close();
              return;
            }
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
            const aspect = `${bitmap.width} / ${bitmap.height}`;
            bitmap.close();
            setFrameAspect((previous) => (previous === aspect ? previous : aspect));
          })
          // A corrupt frame is dropped; the next one repaints.
          .catch(noop)
          .finally(() => {
            decoding = false;
            drawNext();
          });
      };
      return subscribeFrames((frame) => {
        latest = frame;
        drawNext();
      });
    },
    [subscribeFrames],
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
    const drawn = drawnScreenRect(event.currentTarget);
    const travelPx = Math.hypot(
      (end.x - press.start.x) * drawn.width,
      (end.y - press.start.y) * drawn.height,
    );
    if (travelPx < SWIPE_THRESHOLD_PX) onTap?.(end);
    else onSwipe?.(press.start, end, Math.round(performance.now() - press.at));
  };

  return (
    <div
      className={cn('flex h-full w-full items-center justify-center overflow-hidden', className)}
    >
      {/* Device-style bezel around the live screen; appears once the first frame reports its
          aspect. Deliberately theme-independent — a hardware frame is black in both themes.
          The aspect-ratio + max constraints contain-fit the box inside the pane. */}
      <div
        className={cn(
          'w-full max-h-full max-w-full rounded-[34px] border border-neutral-700/60 bg-neutral-950 p-2.5 shadow-xl',
          frameAspect === null && 'hidden',
        )}
        style={frameAspect === null ? undefined : { aspectRatio: frameAspect }}
      >
        <canvas
          ref={canvasRef}
          className="size-full touch-none rounded-[24px] object-contain"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            pressRef.current = null;
          }}
        />
      </div>
      {frameAspect === null && placeholder}
    </div>
  );
}

/** The screen bitmap's on-page box: the canvas is `object-contain`, so the drawn frame can be
 * letterboxed inside the element (the bezel's fixed padding skews the content-box aspect). */
function drawnScreenRect(canvas: HTMLCanvasElement): {
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

function normalizedPoint(event: React.PointerEvent<HTMLCanvasElement>): SimulatorScreenPoint {
  const drawn = drawnScreenRect(event.currentTarget);
  return {
    x: clamp((event.clientX - drawn.left) / drawn.width, 0, 1),
    y: clamp((event.clientY - drawn.top) / drawn.height, 0, 1),
  };
}

function decodeJpegFrame(base64: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
  return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
}
