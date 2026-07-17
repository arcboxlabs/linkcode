import type { SortDirection } from './types';

/**
 * A column's sort toggle cycle — `null` = unsorted. Toggling advances from the current
 * state's position, wrapping; an unsorted column whose cycle lacks `null` enters at
 * the first entry and can never be cleared by toggling.
 */
export type SortingCycle = ReadonlyArray<SortDirection | null>;

/** asc → desc → cleared — the cycle used when a sortable column declares none. */
export const DEFAULT_SORTING_CYCLE: SortingCycle = ['asc', 'desc', null];

// Plain immutable column description (React Compiler-safe). `skeleton` is required
// at the type level so every column ships a colocated loading placeholder.
interface DataTableColumnBase<TData> {
  header: React.ReactNode;
  /** Declared column width in px, surfaced via `useTableRender`; omit for content-sized. */
  width?: number;
  /**
   * Clamp bounds for column resizing (useTableColumnSizing), deliberately NOT generic
   * layout constraints; omitted bounds fall back to the hook's floor / unbounded growth.
   */
  resizeMinWidth?: number;
  resizeMaxWidth?: number;
  skeleton: React.ReactNode;
  cell: (row: TData) => React.ReactNode;
}

// A sortable column must declare an explicit `id` — it doubles as the backend sort
// field. Otherwise `id` is optional; createTable falls back to the column index.
export type DataTableColumn<TData> = DataTableColumnBase<TData> &
  (
    | {
        sortable: true;
        id: string;
        /** This column's toggle cycle. Defaults to DEFAULT_SORTING_CYCLE (asc → desc → cleared). */
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
  getRowId: (row: TData, index: number) => React.Key;
  getCellId: (
    row: TData,
    column: ResolvedDataTableColumn<TData>,
    rowIndex: number,
    columnIndex: number,
  ) => React.Key;
}

interface CreateTableOptions<TData> {
  columns: Array<DataTableColumn<TData>>;
  /** Table-level default sorting cycle, inherited by sortable columns that omit their own. */
  sortingCycle?: SortingCycle;
  /**
   * Row identity for React keys (consumed via `useTableRender`). Defaults to the array
   * index; provide the entity id whenever rows can reorder (sorting/pagination).
   */
  getRowId?: (row: TData, index: number) => React.Key;
  /**
   * Cell identity for React keys (consumed via `useTableRender`). Defaults to
   * `getRowId` + resolved column `id`, so a custom `getRowId` upgrades cell ids too.
   */
  getCellId?: (
    row: TData,
    column: ResolvedDataTableColumn<TData>,
    rowIndex: number,
    columnIndex: number,
  ) => React.Key;
}

const defaultGetRowId = (_row: unknown, index: number): React.Key => index;

/**
 * Define a table at module scope in a module free of hooks and client-only APIs;
 * module-scope JSX (header/skeleton) is created once, so React can skip it on re-render.
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
