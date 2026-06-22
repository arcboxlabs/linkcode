import { useStateWithDeps } from 'foxact/use-state-with-deps';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useMemo } from 'react';
import type { TableDefinition } from './create-table';
import { DEFAULT_SORTING_CYCLE } from './create-table';
import type { SortDirection } from './types';
import type { TablePaginationState } from './use-table-pagination-state';

/** Pre-bound per-column handler — attach to BOTH onClick and onKeyDown. */
export type ToggleSortingHandler = (event: ReactKeyboardEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => void;

/** Per-column sort directions keyed by column id — `undefined` = not sorted. */
export type TableSortsState = Record<string, SortDirection | undefined>;

export type TableSortMode = 'single' | 'multiple';

/**
 * One hook for both sorting modes: after the per-column record refactor, the
 * only behavioral difference left is what activating a new column does —
 * 'single' replaces the current sort, 'multiple' appends a tiebreaker — so the
 * mode is an option, not a separate hook, and the UI wires up identically.
 *
 * Directions and precedence are deliberately separate state: the record gives
 * per-column dependency tracking (flipping one column's direction never
 * re-renders readers of another column), while the array carries ONLY the
 * precedence order.
 */
export interface TableSort {
  /**
   * Dependency-tracked snapshot of per-column sort directions: reading
   * `sorts[columnId]` during render subscribes the component to that column
   * only. Never spread or copy it into a new object, that snapshots current
   * values and breaks the tracking.
   */
  readonly sorts: Readonly<TableSortsState>;
  /**
   * Active column ids in precedence order (click recency: first sorted =
   * primary) — at most one entry in 'single' mode. Serialize by mapping it
   * over `sorts`: `order.map((id) => ({ id, direction: sorts[id]! }))`.
   */
  readonly order: readonly string[];
  /**
   * Per-column preview of the direction toggling THAT column would apply —
   * `nextSorts[columnId]` (`undefined` = the sort would be removed). Read it
   * directly (like `sorts`) to derive a header's `title` / aria label; the
   * getters read the tracked sort state, so accessing during render keeps the
   * label live. Only keys for the definition's columns exist.
   */
  readonly nextSorts: Readonly<TableSortsState>;
  /** Set one column's direction verbatim (`undefined` removes it from the order). */
  setSort: (columnId: string, direction: SortDirection | undefined) => void;
  toggleSort: (columnId: string) => void;
  /**
   * Toggle a column's sort from an event — handles BOTH click and keyboard
   * (Enter/Space, with preventDefault). Pass the column id and the event.
   * `createTableRender` pre-binds the column id into a per-column
   * `ToggleSortingHandler` so most callers never call this directly.
   */
  toggleSortingHandler: (
    columnId: string,
    event: ReactKeyboardEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
  ) => void;
}

interface UseTableSortOptions<TData> {
  /**
   * The table definition — hand it over to honor per-column `sortingCycle`
   * declarations. Without it every column uses DEFAULT_SORTING_CYCLE.
   */
  table?: TableDefinition<TData>;
  /**
   * 'single' (default): sorting a new column replaces the active sort.
   * 'multiple': it appends as the last tiebreaker.
   */
  mode?: TableSortMode;
  /**
   * The backend's default ordering — restored when toggling removes the last
   * sort. Key insertion order is the default precedence.
   */
  defaultSorts?: Record<string, SortDirection>;
  /**
   * Hand over the pagination state instance and every sort change automatically
   * resets to the first page (sorting reorders the result set, so the current
   * page position is meaningless). Type-only coupling — composing the two
   * features costs no extra wiring code.
   */
  pagination?: Pick<TablePaginationState, 'firstPage'>;
  /** Fired after every sort change, for reactions `pagination` doesn't cover. */
  onSortChange?: () => void;
}

export function useTableSort<TData = unknown>({
  table,
  mode = 'single',
  defaultSorts = {},
  pagination,
  onSortChange,
}: UseTableSortOptions<TData> = {}): TableSort {
  // copied because foxact mutates its internal state object in place
  const [sorts, setSortsState] = useStateWithDeps<TableSortsState>({ ...defaultSorts });
  const [orderState, setOrderState] = useStateWithDeps<{ order: string[] }>({ order: Object.keys(defaultSorts) });

  const onAfterSortChange = useCallback(() => {
    pagination?.firstPage();
    onSortChange?.();
  }, [pagination, onSortChange]);

  const setSort = useCallback(
    (columnId: string, direction: SortDirection | undefined) => {
      // the tracked getters return the latest value wherever they are read
      const wasActive = sorts[columnId] !== undefined;
      const prevOrder = orderState.order;

      if (direction === undefined) {
        setSortsState({ [columnId]: undefined });
        if (wasActive) setOrderState({ order: prevOrder.filter((id) => id !== columnId) });
      } else if (mode === 'single') {
        // activating a column replaces the current sort — evict the rest atomically
        const payload: TableSortsState = { [columnId]: direction };
        for (const id of prevOrder) {
          if (id !== columnId) payload[id] = undefined;
        }
        setSortsState(payload);
        // skip the order write when it is already exactly [columnId]
        if (!wasActive || prevOrder.length !== 1) setOrderState({ order: [columnId] });
      } else {
        setSortsState({ [columnId]: direction });
        // newly sorted columns become the last tiebreaker
        if (!wasActive) setOrderState({ order: [...prevOrder, columnId] });
      }

      onAfterSortChange();
    },
    [sorts, orderState, mode, setSortsState, setOrderState, onAfterSortChange],
  );

  // Advance the column's sorting cycle (default: unsorted → asc → desc → removed).
  // Private: the live value reaches the UI through the `nextSorts` field, not a
  // method call.
  const computeNextSort = useCallback(
    (columnId: string): SortDirection | undefined => {
      const cycle = table?.columnsById.get(columnId)?.sortingCycle ?? table?.sortingCycle ?? DEFAULT_SORTING_CYCLE;
      // the tracked getter returns the latest value wherever it is read
      const current = sorts[columnId] ?? null;
      const index = cycle.indexOf(current);
      // current state not in the cycle (e.g. unsorted with a null-less cycle) — enter at the start
      const next = index === -1 ? cycle[0] : cycle[(index + 1) % cycle.length];
      return next ?? undefined;
    },
    [table, sorts],
  );

  // A per-column record of getters so the UI reads `nextSorts[columnId]` directly
  // (matching how it reads `sorts`); each getter reads the tracked `sorts` at
  // access time, so the preview stays live without exposing a method.
  const nextSorts = useMemo(() => {
    const result: TableSortsState = {};
    for (const column of table?.columns ?? []) {
      const { id } = column;
      Object.defineProperty(result, id, { enumerable: true, get: () => computeNextSort(id) });
    }
    return result;
  }, [table, computeNextSort]);

  const toggleSort = useCallback(
    (columnId: string) => {
      const next = computeNextSort(columnId);

      if (next === undefined) {
        // removing the last active sort restores the backend default ordering
        const someOtherActive = orderState.order.some((id) => id !== columnId);
        if (!someOtherActive) {
          const reset: TableSortsState = {};
          for (const key of Object.keys(sorts)) reset[key] = undefined;
          setSortsState({ ...reset, ...defaultSorts });
          setOrderState({ order: Object.keys(defaultSorts) });
          onAfterSortChange();
          return;
        }
      }

      setSort(columnId, next);
    },
    [sorts, orderState, computeNextSort, setSort, setSortsState, setOrderState, defaultSorts, onAfterSortChange],
  );

  const toggleSortingHandler = useCallback(
    (columnId: string, event: ReactKeyboardEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
      if ('key' in event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
      }
      toggleSort(columnId);
    },
    [toggleSort],
  );

  // The instance is created once and stays referentially stable — passing it as
  // a prop never invalidates memoized children by itself. `sorts` IS a tracked
  // snapshot and `order` delegates to one, so reads stay live AND register
  // render dependencies (per column id for directions).
  return useMemo(
    () => ({
      sorts,
      nextSorts,
      get order() {
        return orderState.order;
      },
      setSort,
      toggleSort,
      toggleSortingHandler,
    }),
    [sorts, nextSorts, orderState, setSort, toggleSort, toggleSortingHandler],
  );
}
