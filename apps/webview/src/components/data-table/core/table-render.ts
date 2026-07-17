import type { ResolvedDataTableColumn, TableDefinition } from './create-table';
import type { SortDirection } from './types';
import type { TableColumnSizing, TableColumnSizingHeader } from './use-table-column-sizing';
import type { TableSort, ToggleSortingHandler } from './use-table-sort';

// ── Sort feature fields (present when `sort` is passed) ──

interface TableRenderColumnSortFields {
  sortDirection: SortDirection | undefined;
  nextSortDirection: SortDirection | undefined;
  sortHandler: ToggleSortingHandler;
}

// ── Column sizing feature fields (present when `columnSizing` is passed) ──

type TableRenderColumnSizingFields = Pick<
  TableColumnSizingHeader,
  'width' | 'isResizing' | 'resizeHandler' | 'resetSize'
>;

// ── Conditional feature overlay types ──

type SortOverlay<TSort> = TSort extends TableSort ? TableRenderColumnSortFields : object;
type SizingOverlay<TSizing> = TSizing extends TableColumnSizing
  ? TableRenderColumnSizingFields
  : object;

// ── Core types ──

export interface TableRenderColumn<TData, TSort = undefined, TSizing = undefined> {
  key: React.Key;
  column: ResolvedDataTableColumn<TData>;
  width: number | undefined;
  sort: SortOverlay<TSort>;
  sizing: SizingOverlay<TSizing>;
}

export interface TableRenderCell<TData> {
  key: React.Key;
  column: ResolvedDataTableColumn<TData>;
  node: React.ReactNode;
}

export interface TableRenderRow<TData> {
  key: React.Key;
  data: TData;
  cells: Array<TableRenderCell<TData>>;
}

export interface TableRender<TData, TSort = undefined, TSizing = undefined> {
  columns: Array<TableRenderColumn<TData, TSort, TSizing>>;
  rows: Array<TableRenderRow<TData>>;
}

/**
 * Pre-keys every column/row/cell and invokes the cell renderers, so UI maps
 * `columns` / `rows` straight into elements. Undefined `data` (first fetch) yields
 * no rows — loading/empty branching stays with the caller. Optional `features` folds
 * sort / column-sizing state into each rendered column (no manual id lookups).
 * Pure derivation, deliberately NOT a hook, so React Compiler memoizes call sites.
 */
export function createTableRender<
  TData,
  TSort extends TableSort | undefined = undefined,
  TSizing extends TableColumnSizing | undefined = undefined,
>(
  table: TableDefinition<TData>,
  data: TData[] | undefined,
  features?: { sort?: TSort; columnSizing?: TSizing },
): TableRender<TData, TSort, TSizing> {
  const { sort, columnSizing } = features ?? {};

  const sizingHeadersById = columnSizing
    ? new Map(columnSizing.headers.map((h) => [h.id, h]))
    : undefined;

  const columns = table.columns.map((column) => {
    const sizingHeader = sizingHeadersById?.get(column.id);

    return {
      key: column.id,
      column,
      width: sizingHeader?.width ?? column.width,
      sort: (sort
        ? {
            sortDirection: sort.sorts[column.id],
            nextSortDirection: sort.nextSorts[column.id],
            sortHandler: (event) => sort.toggleSortingHandler(column.id, event),
          }
        : {}) as SortOverlay<TSort>,
      sizing: (sizingHeader
        ? {
            width: sizingHeader.width,
            isResizing: sizingHeader.isResizing,
            resizeHandler: sizingHeader.resizeHandler,
            resetSize: sizingHeader.resetSize,
          }
        : {}) as SizingOverlay<TSizing>,
    };
  });

  return {
    columns,
    rows:
      data === undefined
        ? []
        : data.map((row, rowIndex) => ({
            key: table.getRowId(row, rowIndex),
            data: row,
            cells: columns.map(({ column }, columnIndex) => ({
              key: table.getCellId(row, column, rowIndex, columnIndex),
              column,
              node: column.cell(row),
            })),
          })),
  };
}
