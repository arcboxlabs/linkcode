import { cn } from '@linkcode/ui';
import { useRef } from 'react';

interface DragState {
  pointerId: number;
  startCoord: number;
  startSize: number;
  lastSize: number;
}

/**
 * Drag handle on a workspace grid divider. Positioning comes from the `className` hook
 * (index.css — it rides the same `--lc-*-col`/`--lc-*-row` variables as the grid tracks).
 * Dragging writes the pane's shell CSS variable imperatively per frame via `onResize`
 * (no React state, no transition — [data-shell-animating] is absent) and commits the
 * final size to the layout store on release.
 */
export function Sash({
  orientation,
  edge,
  className,
  size,
  minSize,
  maxSize,
  disabled = false,
  onResize,
  onResizeEnd,
  onReset,
}: {
  orientation: 'vertical' | 'horizontal';
  /** Which end of the axis the pane occupies: `start` grows with the pointer (sidebar),
   * `end` grows against it (right/bottom panels). */
  edge: 'start' | 'end';
  className: string;
  /** The pane's settled size from the layout store (drag baseline). */
  size: number;
  minSize: number;
  maxSize: number;
  disabled?: boolean;
  onResize: (size: number) => void;
  onResizeEnd: (size: number) => void;
  onReset: () => void;
}): React.ReactNode {
  const dragRef = useRef<DragState | null>(null);

  const readCoord = (event: React.PointerEvent<HTMLDivElement>): number =>
    orientation === 'vertical' ? event.clientX : event.clientY;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || event.button !== 0) return;
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
    if (!drag) return;
    if (event.pointerId !== drag.pointerId) return;
    const delta = readCoord(event) - drag.startCoord;
    const requested = edge === 'start' ? drag.startSize + delta : drag.startSize - delta;
    const next = Math.min(maxSize, Math.max(minSize, requested));
    if (next !== drag.lastSize) {
      drag.lastSize = next;
      onResize(next);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    delete event.currentTarget.dataset.dragging;
    onResizeEnd(drag.lastSize);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'linkcode-shell-sash absolute z-10',
        orientation === 'vertical' ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={onReset}
    />
  );
}
