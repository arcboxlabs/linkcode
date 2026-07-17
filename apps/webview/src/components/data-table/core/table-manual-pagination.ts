export interface TableManualPagination<TData> {
  /** The current page slice — feed it to the table as `data`. Undefined while the full row set is. */
  rows: TData[] | undefined;
  /** Feed these to the pagination render layer, exactly like a server response would. */
  pageCount: number;
  rowCount: number;
}

/**
 * Front-end pagination: slices the current page from a client-owned full row set,
 * shaped like a server pagination response. An out-of-range page index is clamped
 * for slicing only — the pagination state is not mutated.
 * Deliberately NOT a hook and takes plain values, not the pagination instance:
 * reading its tracked getters here would break React Compiler call-site memoization.
 * Read `pagination.pageIndex` / `pagination.pageSize` at the call site and pass them in.
 */
export function paginateTableData<TData>(
  data: TData[] | undefined,
  pageIndex: number,
  pageSize: number,
): TableManualPagination<TData> {
  if (data === undefined) return { rows: undefined, pageCount: 0, rowCount: 0 };

  const rowCount = data.length;
  const pageCount = Math.ceil(rowCount / pageSize);
  const safePageIndex = Math.max(0, Math.min(pageIndex, pageCount - 1));
  const start = safePageIndex * pageSize;

  return { rows: data.slice(start, start + pageSize), pageCount, rowCount };
}
