import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useStateWithDeps } from 'foxact/use-state-with-deps';
import { clamp } from 'foxts/clamp';
import { useCallback, useMemo, useRef } from 'react';
import type { TableDefinition } from './create-table';

/**
 * - `onChange`: the column width updates live while dragging.
 * - `onEnd`: the column width only commits when the drag is released.
 */
export type ColumnResizeMode = 'onChange' | 'onEnd';

// Fallback floor when a column declares no `resizeMinWidth` — same as TanStack
// Table's default minSize.
const MIN_COLUMN_WIDTH = 20;

export interface TableColumnSizingHeader {
  id: string;
  /** Current width: the resized override, falling back to the declared definition width. */
  width: number | undefined;
  isResizing: boolean;
  /** Attach to BOTH onMouseDown and onTouchStart of the column's resize handle. */
  resizeHandler: (event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => void;
  /** Attach to onDoubleClick of the resize handle — restores the declared width. */
  resetSize: () => void;
}

export interface TableColumnSizing {
  headers: TableColumnSizingHeader[];
  /** Whether any column is currently being resized. */
  isResizing: boolean;
}

interface UseTableColumnSizingOptions<TData> {
  /** The table definition whose columns are resizable. */
  table: TableDefinition<TData>;
  columnResizeMode?: ColumnResizeMode;
}

function getClientX(event: { clientX: number } | { touches: TouchList }): number | undefined {
  if ('touches' in event) {
    // touchend/touchcancel fire with an empty TouchList
    return event.touches.length > 0 ? event.touches[0].clientX : undefined;
  }
  return event.clientX;
}

interface ActiveDrag {
  columnId: string;
  startClientX: number;
  startWidth: number;
  /** clamp bounds captured from the column definition at drag start */
  minWidth: number;
  maxWidth: number;
  /** staged width for `onEnd` mode: moves accumulate here and commit on release */
  pendingWidth: number | null;
}

export function useTableColumnSizing<TData>({
  table,
  columnResizeMode = 'onEnd',
}: UseTableColumnSizingOptions<TData>): TableColumnSizing {
  // Width overrides keyed by column id at the TOP level of the tracked snapshot, so
  // resizing one column only re-renders readers of that column's width. `undefined` =
  // no override; useStateWithDeps tracks keys it has never seen, so starting empty is fine.
  const [widths, setWidths] = useStateWithDeps<Record<string, number | undefined>>({});
  const [resizing, setResizing] = useStateWithDeps<{ resizingId: string | null }>({
    resizingId: null,
  });
  // The in-flight drag. The document listeners below are attached once per mount
  // and consult this ref — null means "no drag, bail immediately".
  const dragRef = useRef<ActiveDrag | null>(null);

  useLayoutEffect(() => {
    const onMove = (event: MouseEvent | TouchEvent) => {
      const drag = dragRef.current;
      if (drag === null) return;
      const clientX = getClientX(event);
      if (clientX === undefined) return;
      // prevent scrolling while dragging on touch devices
      event.preventDefault();

      const nextWidth = clamp(
        drag.startWidth + (clientX - drag.startClientX),
        drag.minWidth,
        drag.maxWidth,
      );
      if (columnResizeMode === 'onChange') {
        setWidths({ [drag.columnId]: nextWidth });
      } else {
        drag.pendingWidth = nextWidth;
      }
    };

    const onEnd = () => {
      const drag = dragRef.current;
      if (drag === null) return;
      dragRef.current = null;

      if (drag.pendingWidth !== null) {
        setWidths({ [drag.columnId]: drag.pendingWidth });
      }
      setResizing({ resizingId: null });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [columnResizeMode, setWidths, setResizing]);

  const startResize = useCallback(
    (columnId: string, event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => {
      const startClientX = getClientX(event.nativeEvent);
      if (startClientX === undefined) return;
      event.preventDefault();

      const column = table.columnsById.get(columnId);
      // measure the th when the column has no override and no declared width
      const startWidth =
        widths[columnId] ??
        column?.width ??
        (event.currentTarget.closest('th')?.getBoundingClientRect().width || MIN_COLUMN_WIDTH);

      dragRef.current = {
        columnId,
        startClientX,
        startWidth,
        minWidth: column?.resizeMinWidth ?? MIN_COLUMN_WIDTH,
        maxWidth: column?.resizeMaxWidth ?? Number.POSITIVE_INFINITY,
        pendingWidth: null,
      };
      setResizing({ resizingId: columnId });
    },
    [table, widths, setResizing],
  );

  // width/isResizing are getters into the tracked snapshots — reads stay live and
  // register per-column render dependencies, so one resize never invalidates another.
  return useMemo(
    () => ({
      headers: table.columns.map((column) => ({
        id: column.id,
        get width() {
          return widths[column.id] ?? column.width;
        },
        get isResizing() {
          return resizing.resizingId === column.id;
        },
        resizeHandler(event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) {
          startResize(column.id, event);
        },
        resetSize() {
          // undefined = drop the override and fall back to the declared width
          // (the tracked key stays registered, which is fine)
          setWidths({ [column.id]: undefined });
        },
      })),
      get isResizing() {
        return resizing.resizingId !== null;
      },
    }),
    [table, widths, resizing, setWidths, startResize],
  );
}
