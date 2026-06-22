import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'coss-ui/components/table';
import type { ReactElement, ReactNode } from 'react';
import type { TableDefinition } from '@/components/data-table/create-table';

export type { DataTableColumn, TableDefinition } from '@/components/data-table/create-table';
export { createTable } from '@/components/data-table/create-table';

export interface DataTableProps<TData> {
  table: TableDefinition<TData>;
  data: TData[] | undefined;
  isLoading: boolean;
  empty?: ReactNode;
  skeletonRows?: number;
  onRowClick?: (row: TData) => void;
}

export function DataTable<TData>({
  table,
  data,
  isLoading,
  empty = 'No results.',
  skeletonRows = 8,
  onRowClick,
}: DataTableProps<TData>): ReactElement {
  const isFirstLoading = isLoading && data === undefined;
  const rows = data ?? [];
  const isEmpty = !isFirstLoading && rows.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {table.columns.map((column) => (
              <TableHead key={column.id} style={column.width ? { width: column.width } : undefined}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isFirstLoading
            ? Array.from({ length: skeletonRows }, (_, rowIndex) => (
                <TableRow key={rowIndex}>
                  {table.columns.map((column) => (
                    <TableCell key={column.id}>{column.skeleton}</TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row, rowIndex) => (
                <TableRow
                  className={onRowClick ? 'cursor-pointer' : undefined}
                  key={table.getRowId(row, rowIndex)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {table.columns.map((column) => (
                    <TableCell key={column.id}>{column.cell(row)}</TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {isEmpty && (
        <div className="flex min-h-40 items-center justify-center text-muted-foreground text-sm">
          {empty}
        </div>
      )}
    </div>
  );
}
