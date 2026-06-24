import { useStateWithDeps } from 'foxact/use-state-with-deps';
import { useCallback } from 'react';

/**
 * Raw pagination state, mounted ABOVE the data-fetching hook so the fetch key
 * can read `pageIndex` / `pageSize`. Knows nothing about page count — pass this
 * instance to `usePaginationRender` below the fetch to get the derived
 * helpers (canNextPage, range, ...).
 *
 * State fields are getters delegating to a dependency-tracked snapshot (foxact
 * `useStateWithDeps`): reading a field during render subscribes the component to
 * exactly the state it depends on. Read fields directly off the instance — never
 * spread it or copy fields into a new object, that snapshots current values and
 * breaks the getter-based tracking.
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

  // The getters delegate to the tracked snapshot, so they always return the latest
  // value AND register the reading component as a dependent of that field.
  //
  // Due to that reason, this return object should never be wrapped with `useMemo`.
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
