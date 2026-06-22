import type { Key, ReactNode } from 'react';

export interface DataTableColumn<TData> {
  id: string;
  header: ReactNode;
  width?: number;
  skeleton: ReactNode;
  cell: (row: TData) => ReactNode;
}

export interface TableDefinition<TData> {
  columns: Array<DataTableColumn<TData>>;
  getRowId: (row: TData, index: number) => Key;
}

export function createTable<TData>({
  columns,
  getRowId = (_row, index) => index,
}: {
  columns: Array<DataTableColumn<TData>>;
  getRowId?: (row: TData, index: number) => Key;
}): TableDefinition<TData> {
  return { columns, getRowId };
}
