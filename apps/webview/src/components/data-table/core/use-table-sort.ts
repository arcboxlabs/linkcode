import { useStateWithDeps } from 'foxact/use-state-with-deps';
import { useCallback, useMemo } from 'react';
import type { TableDefinition } from './create-table';
import { DEFAULT_SORTING_CYCLE } from './create-table';
import type { SortDirection } from './types';
import type { TablePaginationState } from './use-table-pagination-state';

/** Pre-bound per-column handler — attach to BOTH onClick and onKeyDown. */
export type ToggleSortingHandler = (
  event: React.KeyboardEvent<HTMLElement> | React.MouseEvent<HTMLElement>,
) => void;

/** Per-column sort directions keyed by column id — `undefined` = not sorted. */
export type TableSortsState = Record<string, SortDirection | undefined>;

export type TableSortMode = 'single' | 'multiple';

/**
 * One hook for both sorting modes; the only difference is activating a new column —
 * 'single' replaces the current sort, 'multiple' appends a tiebreaker. Directions
 * (record, per-column dependency tracking) and precedence (array) are deliberately
 * separate state.
 */
export interface TableSort {
  /**
   * Dependency-tracked snapshot of per-column sort directions — reading subscribes per
   * column. Never spread or copy it; that snapshots current values and breaks tracking.
   */
  readonly sorts: Readonly<TableSortsState>;
  /**
   * Active column ids in precedence order (first sorted = primary); at most one
   * entry in 'single' mode. Serialize by mapping it over `sorts`.
   */
  readonly order: readonly string[];
  /**
   * Per-column preview of the direction toggling that column would apply (`undefined` =
   * removed). Read directly like `sorts` (live getters); only definition columns are keyed.
   */
  readonly nextSorts: Readonly<TableSortsState>;
  /** Set one column's direction verbatim (`undefined` removes it from the order). */
  setSort: (columnId: string, direction: SortDirection | undefined) => void;
  toggleSort: (columnId: string) => void;
  /**
   * Toggle a column's sort from an event — handles both click and keyboard (Enter/Space).
   * `createTableRender` pre-binds it per column, so most callers never call this directly.
   */
  toggleSortingHandler: (
    columnId: string,
    event: React.KeyboardEvent<HTMLElement> | React.MouseEvent<HTMLElement>,
  ) => void;
}

interface UseTableSortOptions<TData> {
  /** Honors per-column `sortingCycle` declarations; without it every column uses DEFAULT_SORTING_CYCLE. */
  table?: TableDefinition<TData>;
  /** 'single' (default): sorting a new column replaces the active sort; 'multiple': it appends a tiebreaker. */
  mode?: TableSortMode;
  /** The backend's default ordering, restored when toggling removes the last sort; key insertion order = precedence. */
  defaultSorts?: Record<string, SortDirection>;
  /**
   * Hand over the pagination state and every sort change resets to the first page
   * (sorting reorders the result set, invalidating the current page position).
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
  const [orderState, setOrderState] = useStateWithDeps<{ order: string[] }>({
    order: Object.keys(defaultSorts),
  });

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

  // Advance the column's sorting cycle. Private: the UI reads the live value
  // through the `nextSorts` getters, not a method call.
  const computeNextSort = useCallback(
    (columnId: string): SortDirection | undefined => {
      const cycle =
        table?.columnsById.get(columnId)?.sortingCycle ??
        table?.sortingCycle ??
        DEFAULT_SORTING_CYCLE;
      // the tracked getter returns the latest value wherever it is read
      const current = sorts[columnId] ?? null;
      const index = cycle.indexOf(current);
      // current state not in the cycle (e.g. unsorted with a null-less cycle) — enter at the start
      const next = index === -1 ? cycle[0] : cycle[(index + 1) % cycle.length];
      return next ?? undefined;
    },
    [table, sorts],
  );

  // Per-column getters so the UI reads `nextSorts[columnId]` like `sorts`; each
  // getter reads the tracked `sorts` at access time, keeping the preview live.
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
    [
      sorts,
      orderState,
      computeNextSort,
      setSort,
      setSortsState,
      setOrderState,
      defaultSorts,
      onAfterSortChange,
    ],
  );

  const toggleSortingHandler = useCallback(
    (columnId: string, event: React.KeyboardEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
      if ('key' in event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
      }
      toggleSort(columnId);
    },
    [toggleSort],
  );

  // Referentially stable instance; `sorts` IS a tracked snapshot and `order`
  // delegates to one, so reads stay live and register render dependencies.
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
