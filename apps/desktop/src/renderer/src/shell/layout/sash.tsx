import { cn } from '@linkcode/ui';
import { invariant } from 'foxact/invariant';
import { clamp } from 'foxts/clamp';
import { useRef } from 'react';
import type { SashDragStyleWriter } from './sash-drag-style';
import { createSashDragStyleWriter } from './sash-drag-style';
import type { SashBounds, SashEdge, SashOrientation, SashPane } from './sash-model';
import { getEffectiveSashBounds, getKeyboardSashAction } from './sash-model';

interface DragState {
  pointerId: number;
  startCoord: number;
  startSize: number;
  lastSize: number;
  bounds: SashBounds;
  changed: boolean;
  writer: SashDragStyleWriter;
}

/**
 * Drag handle on a workspace grid divider. Positioning comes from the `className` hook
 * (index.css — it rides the same `--lc-*-col`/`--lc-*-row` variables as the grid tracks).
 * Dragging writes resolved inline tracks per frame through the drag style writer (a
 * per-frame shell-variable rewrite would recalc style across the whole shell — see
 * sash-drag-style.ts); the shell variable and layout store settle once on release.
 */
export function Sash({
  orientation,
  edge,
  pane,
  paneId,
  label,
  className,
  size,
  minSize,
  maxSize,
  minMainSize,
  reclaimFromPane,
  reclaimFromMinSize = 0,
  reclaimFromPreferredSize = 0,
  disabled = false,
  hidden = false,
  onResize,
  onResizeEnd,
  onReset,
}: {
  orientation: SashOrientation;
  /** Which end of the axis the pane occupies: `start` grows with the pointer (sidebar),
   * `end` grows against it (right/bottom panels). */
  edge: SashEdge;
  pane: SashPane;
  paneId: string;
  label: string;
  className: string;
  /** The pane's preferred settled size from the layout store (initial ARIA value and reset target). */
  size: number;
  minSize: number;
  maxSize: number;
  minMainSize: number;
  /** A coupled pane that can yield toward its hard minimum while this pane grows. */
  reclaimFromPane?: SashPane;
  reclaimFromMinSize?: number;
  /** The coupled pane's preferred settled size — the ceiling it re-expands to mid-drag. */
  reclaimFromPreferredSize?: number;
  disabled?: boolean;
  hidden?: boolean;
  onResize: (size: number) => void;
  onResizeEnd: (size: number) => void;
  onReset: () => void;
}): React.ReactNode {
  const dragRef = useRef<DragState | null>(null);

  const readCoord = (event: React.PointerEvent<HTMLDivElement>): number =>
    orientation === 'vertical' ? event.clientX : event.clientY;

  const readGeometry = (element: HTMLDivElement): { size: number; bounds: SashBounds } => {
    const grid = element.parentElement;
    invariant(grid, 'A shell sash must be a direct child of the workspace grid');
    const paneElement = grid.querySelector<HTMLElement>(`[data-shell-pane="${CSS.escape(pane)}"]`);
    const mainElement = grid.querySelector<HTMLElement>('[data-shell-pane="main"]');
    const reclaimElement = reclaimFromPane
      ? grid.querySelector<HTMLElement>(`[data-shell-pane="${CSS.escape(reclaimFromPane)}"]`)
      : null;
    invariant(paneElement, `Missing ${pane} pane for shell sash`);
    invariant(mainElement, 'Missing main pane for shell sash');
    invariant(!reclaimFromPane || reclaimElement, `Missing ${reclaimFromPane} pane for shell sash`);

    const paneRect = paneElement.getBoundingClientRect();
    const mainRect = mainElement.getBoundingClientRect();
    const renderedSize = orientation === 'vertical' ? paneRect.width : paneRect.height;
    const mainSize = orientation === 'vertical' ? mainRect.width : mainRect.height;
    const reclaimSize = reclaimElement
      ? orientation === 'vertical'
        ? reclaimElement.getBoundingClientRect().width
        : reclaimElement.getBoundingClientRect().height
      : 0;
    return {
      size: renderedSize,
      bounds: getEffectiveSashBounds(
        renderedSize,
        mainSize,
        minMainSize,
        minSize,
        maxSize,
        Math.max(0, reclaimSize - reclaimFromMinSize),
      ),
    };
  };

  const syncAriaGeometry = (element: HTMLDivElement, geometry = readGeometry(element)): void => {
    // The stored preference can exceed the window-aware CSS clamp. Refresh the focused
    // control from rendered geometry so assistive technology announces what is on screen.
    element.setAttribute('aria-valuenow', String(Math.round(geometry.size)));
    element.setAttribute('aria-valuemax', String(Math.round(geometry.bounds.max)));
  };

  const finishDrag = (
    element: HTMLDivElement,
    pointerId: number,
    syncShellVariable = true,
  ): void => {
    const drag = dragRef.current;
    if (drag?.pointerId !== pointerId) return;
    dragRef.current = null;
    delete element.dataset.dragging;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    drag.writer.restore();
    if (!drag.changed) return;
    const settled = drag.lastSize === drag.startSize ? size : drag.lastSize;
    // A toggle-interrupted drag must not clobber the variable the toggle just wrote.
    if (syncShellVariable) onResize(settled);
    onResizeEnd(settled);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // One drag at a time: a second (touch) pointer must not reset the baseline mid-drag.
    if (disabled || hidden || dragRef.current !== null || event.button !== 0) return;
    const geometry = readGeometry(event.currentTarget);
    syncAriaGeometry(event.currentTarget, geometry);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragging = '';
    dragRef.current = {
      pointerId: event.pointerId,
      startCoord: readCoord(event),
      startSize: geometry.size,
      lastSize: geometry.size,
      bounds: geometry.bounds,
      changed: false,
      writer: createSashDragStyleWriter(
        event.currentTarget,
        pane,
        minMainSize,
        reclaimFromPreferredSize,
        reclaimFromMinSize,
      ),
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.pointerId !== drag.pointerId) return;
    if (disabled) {
      // A pane toggle started mid-drag; the grid transition is now live, so end the drag
      // where it stands instead of fighting the animation with per-frame writes.
      finishDrag(event.currentTarget, drag.pointerId, false);
      return;
    }
    const delta = readCoord(event) - drag.startCoord;
    const requested = edge === 'start' ? drag.startSize + delta : drag.startSize - delta;
    const next = clamp(requested, drag.bounds.min, drag.bounds.max);
    if (next !== drag.lastSize) {
      drag.lastSize = next;
      drag.changed = true;
      event.currentTarget.setAttribute('aria-valuenow', String(Math.round(next)));
      drag.writer.apply(next);
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    finishDrag(event.currentTarget, event.pointerId);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled || hidden || dragRef.current !== null) return;
    const geometry = readGeometry(event.currentTarget);
    syncAriaGeometry(event.currentTarget, geometry);
    const action = getKeyboardSashAction({
      key: event.key,
      orientation,
      edge,
      size: geometry.size,
      bounds: geometry.bounds,
    });
    if (action === null) return;

    event.preventDefault();
    if (action === 'reset') {
      onReset();
      return;
    }
    if (action === geometry.size) return;
    event.currentTarget.setAttribute('aria-valuenow', String(Math.round(action)));
    onResize(action);
    onResizeEnd(action);
  };

  return (
    <div
      role="separator"
      tabIndex={disabled || hidden ? -1 : 0}
      aria-label={label}
      aria-controls={paneId}
      aria-orientation={orientation}
      aria-valuemin={minSize}
      aria-valuemax={maxSize}
      aria-valuenow={Math.round(size)}
      aria-disabled={disabled || hidden || undefined}
      aria-hidden={hidden || undefined}
      inert={hidden}
      className={cn(
        'linkcode-shell-sash absolute z-10 touch-none select-none outline-none',
        orientation === 'vertical' ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        hidden && 'invisible pointer-events-none',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onFocus={(event) => syncAriaGeometry(event.currentTarget)}
      onKeyDown={handleKeyDown}
      onDoubleClick={disabled || hidden ? undefined : onReset}
    />
  );
}
