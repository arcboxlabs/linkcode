import type { Key, ReactNode } from 'react';
import type { SortDirection } from './types';

/**
 * A column's sort toggle cycle — `null` = unsorted. Toggling advances from the
 * current state's position in the array, wrapping around; an unsorted column
 * whose cycle lacks `null` enters at the first entry (and can never be cleared
 * by toggling). Cycles are rotation-invariant, so leading with the resting
 * state is just a readability convention.
 */
export type SortingCycle = ReadonlyArray<SortDirection | null>;

/** asc → desc → cleared — the cycle used when a sortable column declares none. */
export const DEFAULT_SORTING_CYCLE: SortingCycle = ['asc', 'desc', null];

// Plain immutable column description — no methods, no internal mutation, safe for
// React Compiler memoization. `skeleton` is required at the type level so every
// column ships a loading placeholder colocated with its cell renderer.
interface DataTableColumnBase<TData> {
  header: ReactNode;
  /**
   * Declared column width in px, surfaced via `useTableRender`. Omit for a
   * content-sized column.
   */
  width?: number;
  /**
   * Clamp bounds for column resizing (useTableColumnSizing) — deliberately NOT
   * generic layout constraints, hence the `resize` prefix. Omitted bounds fall
   * back to the hook's floor / unbounded growth.
   */
  resizeMinWidth?: number;
  resizeMaxWidth?: number;
  skeleton: ReactNode;
  cell: (row: TData) => ReactNode;
}

// A sortable column must declare an explicit `id` — it doubles as the sort field
// identifier handed to the backend. Otherwise `id` is optional; createTable
// falls back to the column index.
export type DataTableColumn<TData> = DataTableColumnBase<TData> &
  (
    | {
        sortable: true;
        id: string;
        /**
         * This column's toggle cycle, e.g. `['desc', 'asc', null]` for a
         * metric that should sort descending first. Defaults to
         * DEFAULT_SORTING_CYCLE (asc → desc → cleared).
         */
        sortingCycle?: SortingCycle;
      }
    | { sortable?: false; id?: string; sortingCycle?: undefined }
  );

/** A column inside a TableDefinition — `id` is always resolved by createTable. */
export type ResolvedDataTableColumn<TData> = DataTableColumn<TData> & { id: string };

export interface TableDefinition<TData> {
  columns: Array<ResolvedDataTableColumn<TData>>;
  /** id → column lookup, built once so hooks avoid per-call `columns.find`. */
  columnsById: ReadonlyMap<string, ResolvedDataTableColumn<TData>>;
  /** Table-level default cycle — columns without their own `sortingCycle` inherit this. */
  sortingCycle: SortingCycle;
  getRowId: (row: TData, index: number) => Key;
  getCellId: (
    row: TData,
    column: ResolvedDataTableColumn<TData>,
    rowIndex: number,
    columnIndex: number,
  ) => Key;
}

interface CreateTableOptions<TData> {
  columns: Array<DataTableColumn<TData>>;
  /**
   * Table-level default sorting cycle — sortable columns that omit their own
   * `sortingCycle` inherit this instead of DEFAULT_SORTING_CYCLE.
   */
  sortingCycle?: SortingCycle;
  /**
   * Row identity for React keys, consumed via `useTableRender` — never called
   * directly by UI code. Defaults to the array index (same as TanStack Table's
   * default row id). Provide the entity id (e.g. `row.id`) whenever rows can
   * reorder (sorting/pagination) so React moves the existing DOM instead of
   * rewriting it row by row.
   */
  getRowId?: (row: TData, index: number) => Key;
  /**
   * Cell identity for React keys, consumed via `useTableRender` — never called
   * directly by UI code. Defaults to joining the row id (via `getRowId`) with
   * the resolved column `id`, so a custom `getRowId` upgrades cell ids too.
   */
  getCellId?: (
    row: TData,
    column: ResolvedDataTableColumn<TData>,
    rowIndex: number,
    columnIndex: number,
  ) => Key;
}

const defaultGetRowId = (_row: unknown, index: number): Key => index;

/**
 * Define a table at module scope, in a shared module free of hooks and
 * client-only APIs. Module-scope JSX in the definition (header / skeleton nodes)
 * is created exactly once, giving it stable identity that React can skip on
 * re-render. The `cell` renderers are consumed by `<DataTable>`.
 */
export function createTable<TData>({
  columns,
  sortingCycle = DEFAULT_SORTING_CYCLE,
  getRowId = defaultGetRowId,
  getCellId = (row, column, rowIndex) => `${String(getRowId(row, rowIndex))}-${column.id}`,
}: CreateTableOptions<TData>): TableDefinition<TData> {
  // resolve optional column ids up front so everything downstream can rely on them
  const resolvedColumns = columns.map((column, index) => ({
    ...column,
    id: column.id ?? String(index),
  }));
  return {
    columns: resolvedColumns,
    columnsById: new Map(resolvedColumns.map((column) => [column.id, column])),
    sortingCycle,
    getRowId,
    getCellId,
  };
}
