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
  const [hasFrame, setHasFrame] = useState(false);

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
            bitmap.close();
            setHasFrame(true);
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
    const rect = event.currentTarget.getBoundingClientRect();
    const travelPx = Math.hypot(
      (end.x - press.start.x) * rect.width,
      (end.y - press.start.y) * rect.height,
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
        className={cn('max-h-full max-w-full touch-none', !hasFrame && 'hidden')}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pressRef.current = null;
        }}
      />
      {!hasFrame && placeholder}
    </div>
  );
}

function normalizedPoint(event: React.PointerEvent<HTMLCanvasElement>): SimulatorScreenPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function decodeJpegFrame(base64: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
  return createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
}
