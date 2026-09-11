import { clamp } from 'foxts/clamp';
import { useRef } from 'react';
import { cn } from '../lib/cn';

const KEYBOARD_RESIZE_STEP = 10;

interface DragState {
  pointerId: number;
  startCoord: number;
  startSize: number;
  lastSize: number;
}

function readKeyAction({
  key,
  orientation,
  edge,
  size,
  minSize,
  maxSize,
}: {
  key: string;
  orientation: 'vertical' | 'horizontal';
  edge: 'start' | 'end';
  size: number;
  minSize: number;
  maxSize: number;
}): number | 'reset' | null {
  if (key === 'Enter') return 'reset';
  if (key === 'Home') return minSize;
  if (key === 'End') return maxSize;
  const physicalDelta =
    orientation === 'vertical'
      ? key === 'ArrowLeft'
        ? -KEYBOARD_RESIZE_STEP
        : key === 'ArrowRight'
          ? KEYBOARD_RESIZE_STEP
          : null
      : key === 'ArrowUp'
        ? -KEYBOARD_RESIZE_STEP
        : key === 'ArrowDown'
          ? KEYBOARD_RESIZE_STEP
          : null;
  if (physicalDelta === null) return null;
  const paneDelta = edge === 'start' ? physicalDelta : -physicalDelta;
  return clamp(size + paneDelta, minSize, maxSize);
}

/**
 * A standalone drag divider for resizing an adjacent panel. Unlike the desktop shell's `Sash`,
 * this reads no sibling DOM geometry and writes no styles itself — it only reports a clamped
 * size through `onResize`/`onResizeEnd`, so any panel (in any app) can own how that size is
 * rendered and persisted.
 */
export function ResizeHandle({
  orientation,
  edge,
  size,
  minSize,
  maxSize,
  label,
  controls,
  disabled = false,
  className,
  style,
  onResize,
  onResizeEnd,
  onReset,
}: {
  orientation: 'vertical' | 'horizontal';
  /** Which side of the pointer delta grows the panel: `start` grows with the pointer, `end` grows against it. */
  edge: 'start' | 'end';
  /** The panel's current committed size — the drag baseline and the ARIA value when idle. */
  size: number;
  minSize: number;
  maxSize: number;
  label: string;
  /** `aria-controls`, when the handle has an identifiable panel to point at. */
  controls?: string;
  disabled?: boolean;
  className?: string;
  /** Positioning is the caller's responsibility — there is no shared grid/CSS-variable contract here. */
  style?: React.CSSProperties;
  onResize: (size: number) => void;
  onResizeEnd: (size: number) => void;
  onReset?: () => void;
}): React.ReactNode {
  const dragRef = useRef<DragState | null>(null);

  const readCoord = (event: React.PointerEvent<HTMLDivElement>): number =>
    orientation === 'vertical' ? event.clientX : event.clientY;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || dragRef.current !== null || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = '';
    dragRef.current = {
      pointerId: event.pointerId,
      startCoord: readCoord(event),
      startSize: size,
      lastSize: size,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (disabled || drag?.pointerId !== event.pointerId) return;
    const delta = readCoord(event) - drag.startCoord;
    const requested = edge === 'start' ? drag.startSize + delta : drag.startSize - delta;
    const next = clamp(requested, minSize, maxSize);
    if (next !== drag.lastSize) {
      drag.lastSize = next;
      onResize(next);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onResizeEnd(drag.lastSize);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled || dragRef.current !== null) return;
    const action = readKeyAction({ key: event.key, orientation, edge, size, minSize, maxSize });
    if (action === null) return;
    event.preventDefault();
    if (action === 'reset') {
      onReset?.();
      return;
    }
    if (action === size) return;
    onResize(action);
    onResizeEnd(action);
  };

  return (
    <div
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={orientation}
      aria-valuemin={minSize}
      aria-valuemax={maxSize}
      aria-valuenow={Math.round(size)}
      aria-disabled={disabled || undefined}
      className={cn(
        'touch-none select-none outline-none',
        orientation === 'vertical' ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        className,
      )}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onKeyDown={handleKeyDown}
      onDoubleClick={disabled ? undefined : onReset}
    />
  );
}
