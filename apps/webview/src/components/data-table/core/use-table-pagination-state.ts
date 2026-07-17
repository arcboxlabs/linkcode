import { useStateWithDeps } from 'foxact/use-state-with-deps';
import { useCallback } from 'react';

/**
 * Raw pagination state, mounted ABOVE the data-fetching hook so the fetch key can
 * read `pageIndex` / `pageSize`; page-count-derived helpers come from
 * `usePaginationRender` below the fetch.
 * Fields are getters into a dependency-tracked snapshot — read them directly off
 * the instance; spreading or copying snapshots current values and breaks tracking.
 */
export interface TablePaginationState {
  readonly pageIndex: number;
  readonly pageSize: number;
  setPageIndex: (pageIndex: number) => void;
  setPageSize: (pageSize: number) => void;
  firstPage: () => void;
}

interface UseTablePaginationStateOptions {
  defaultPageSize?: number;
}

export function useTablePaginationState({
  defaultPageSize = 10,
}: UseTablePaginationStateOptions = {}): TablePaginationState {
  const [state, setState] = useStateWithDeps({ pageIndex: 0, pageSize: defaultPageSize });

  const setPageIndex = useCallback((pageIndex: number) => setState({ pageIndex }), [setState]);

  // changing the page size invalidates the current page position — reset to the first page
  const setPageSize = useCallback(
    (pageSize: number) => setState({ pageSize, pageIndex: 0 }),
    [setState],
  );

  const firstPage = useCallback(() => setState({ pageIndex: 0 }), [setState]);

  // Getters delegate to the tracked snapshot (live reads + per-field dependency
  // registration) — never wrap this return object in `useMemo`.
  return {
    get pageIndex() {
      return state.pageIndex;
    },
    get pageSize() {
      return state.pageSize;
    },
    setPageIndex,
    setPageSize,
    firstPage,
  };
}
