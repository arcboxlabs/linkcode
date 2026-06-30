import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Table as UITable,
} from 'coss-ui/components/table';
import { cn } from 'coss-ui/lib/utils';
import { createFixedArray } from 'foxact/create-fixed-array';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { PaginationFooter } from '@/components/pagination';
import { usePaginationRender } from '@/components/pagination/use-pagination-render';
import type { TableDefinition } from './core/create-table';
import { createTableRender } from './core/table-render';
import type { SortDirection } from './core/types';
import type { TablePaginationState } from './core/use-table-pagination-state';
import type { TableSort } from './core/use-table-sort';

export type {
  DataTableColumn,
  ResolvedDataTableColumn,
  SortingCycle,
  TableDefinition,
} from './core/create-table';
export { createTable } from './core/create-table';
export type { TableManualPagination } from './core/table-manual-pagination';
export { paginateTableData } from './core/table-manual-pagination';
export type {
  TableRender,
  TableRenderCell,
  TableRenderColumn,
  TableRenderRow,
} from './core/table-render';
export { createTableRender } from './core/table-render';
export type { SortDirection, SortState } from './core/types';
export type { TableColumnSizing, TableColumnSizingHeader } from './core/use-table-column-sizing';
export { useTableColumnSizing } from './core/use-table-column-sizing';
export type { TablePaginationState } from './core/use-table-pagination-state';
export { useTablePaginationState } from './core/use-table-pagination-state';
export type { TableSort, TableSortMode, TableSortsState } from './core/use-table-sort';
export { useTableSort } from './core/use-table-sort';

const SORT_ICON: Record<SortDirection, ReactNode> = {
  asc: <ChevronUpIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />,
  desc: <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 opacity-80" />,
};

function getSortTitle(next: SortDirection | undefined): string {
  if (next === undefined) return 'Clear sorting';
  return next === 'desc' ? 'Sort descending' : 'Sort ascending';
}

interface DataTableProps<TData> {
  table: TableDefinition<TData>;
  tablePagination: TablePaginationState;
  tableSort: TableSort;
  data: TData[] | undefined;
  isLoading: boolean;
  /** Total page count, from the server response. */
  pageCount: number;
  /** Total row count across all pages, from the server response. */
  rowCount: number;
  /**
   * Rendered below the header row, outside the table element, when the resolved
   * data is empty. A plain ReactNode slot.
   */
  empty?: ReactNode;
  /** Noun for the footer count, e.g. "of 47 machines". */
  rowNoun?: string;
  /** Number of skeleton rows rendered during the first load. */
  skeletonRows?: number;
  fill?: boolean;
  onRowClick?: (row: TData) => void;
}

export function DataTable<TData>({
  table,
  tablePagination,
  tableSort,
  data,
  isLoading,
  pageCount,
  rowCount,
  empty = 'No results.',
  rowNoun = 'results',
  skeletonRows = 8,
  fill = false,
  onRowClick,
}: DataTableProps<TData>) {
  // derived pagination view: only the state hook lives at the call site (the
  // fetch key reads it); the render derivation is DataTable's own concern
  const paginationRender = usePaginationRender({
    pagination: tablePagination,
    pageCount,
    rowCount,
  });
  const { columns, rows } = createTableRender(table, data, { sort: tableSort });

  /* first fetch, no data at all — show full skeletons and hide footer */
  const isFirstLoading = isLoading && data === undefined;
  /* key changed (page/filter), previous data kept via keepPreviousData — dim rows in place */
  const isDimmed = isLoading && data !== undefined;
  /* resolved with no rows — render the empty slot outside the table, below the header */
  const isEmpty = !isFirstLoading && (data === undefined || data.length === 0);

  return (
    <>
      <div
        className={cn(
          'flex-1 overflow-y-auto transition-opacity duration-150',
          isDimmed && 'opacity-50 pointer-events-none',
          isEmpty && 'flex flex-col',
        )}
      >
        <UITable
          className="table-fixed"
          render={fill && !isEmpty ? <div className="h-full" /> : undefined}
        >
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map(({ key, column, width, sort }) => {
                const sortHandler = column.sortable ? sort.sortHandler : undefined;
                return (
                  <TableHead key={key} style={width === undefined ? undefined : { width }}>
                    {sortHandler ? (
                      <div
                        className="flex h-full cursor-pointer select-none items-center justify-between gap-2"
                        onClick={sortHandler}
                        onKeyDown={sortHandler}
                        role="button"
                        tabIndex={0}
                        title={getSortTitle(sort.nextSortDirection)}
                      >
                        {column.header}
                        {sort.sortDirection ? SORT_ICON[sort.sortDirection] : null}
                      </div>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isFirstLoading
              ? createFixedArray(skeletonRows).map((i) => (
                  <TableRow key={i}>
                    {columns.map(({ key, column }) => (
                      <TableCell key={key}>{column.skeleton}</TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.map(({ key, data: row, cells }) => (
                  <TableRow
                    key={key}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {cells.map(({ key: cellKey, node }) => (
                      <TableCell key={cellKey}>{node}</TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </UITable>
        {isEmpty && (
          <div className="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground">
            {empty}
          </div>
        )}
      </div>

      {!isFirstLoading && <PaginationFooter pagination={paginationRender} rowNoun={rowNoun} />}
    </>
  );
}
