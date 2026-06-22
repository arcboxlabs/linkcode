export interface TableManualPagination<TData> {
  /** The current page slice — feed it to the table as `data`. Undefined while the full row set is. */
  rows: TData[] | undefined;
  /** Feed these to the pagination render layer, exactly like a server response would. */
  pageCount: number;
  rowCount: number;
}

/**
 * Front-end pagination: the client owns the FULL row set (already sorted/filtered)
 * and this slices the current page out of it locally — the counterpart of server
 * pagination, where the backend slices and `pageCount`/`rowCount` arrive in the
 * response. The outputs are shaped to drop into the same places.
 *
 * A page index pointing past the end (e.g. the row set shrank) is clamped to the
 * last page for slicing; the pagination state itself is not mutated.
 *
 * Pure derivation, deliberately NOT a hook. It also deliberately takes plain
 * values instead of the pagination state instance: reading the instance's
 * tracked getters in here would make the result change under unchanged argument
 * identities, which breaks React Compiler's call-site memoization. Read
 * `pagination.pageIndex` / `pagination.pageSize` at the call site (subscribing
 * the component) and pass the values in.
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
