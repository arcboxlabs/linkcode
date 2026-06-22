import { Button } from 'coss-ui/components/button';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from 'coss-ui/components/pagination';
import type { ReactElement } from 'react';

export interface PaginationState {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  rowCount: number;
  setPageIndex: (pageIndex: number) => void;
}

export function PaginationFooter({
  pagination,
  rowNoun = 'results',
}: {
  pagination: PaginationState;
  rowNoun?: string;
}): ReactElement | null {
  if (pagination.rowCount <= 0) return null;

  const canPreviousPage = pagination.pageIndex > 0;
  const canNextPage = pagination.pageIndex + 1 < pagination.pageCount;
  const start = pagination.pageIndex * pagination.pageSize + 1;
  const end = Math.min((pagination.pageIndex + 1) * pagination.pageSize, pagination.rowCount);

  return (
    <div className="flex min-h-14 shrink-0 items-center justify-between border-t border-border px-5 py-3 text-muted-foreground text-sm">
      <p>
        Viewing {start}-{end} of{' '}
        <strong className="font-medium text-foreground">{pagination.rowCount}</strong> {rowNoun}
      </p>
      <Pagination className="justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              aria-disabled={!canPreviousPage}
              className={canPreviousPage ? '' : 'pointer-events-none opacity-50'}
              onClick={() => pagination.setPageIndex(Math.max(0, pagination.pageIndex - 1))}
            />
          </PaginationItem>
          <PaginationItem>
            <Button size="sm" variant="outline">
              {pagination.pageIndex + 1} / {Math.max(1, pagination.pageCount)}
            </Button>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              aria-disabled={!canNextPage}
              className={canNextPage ? '' : 'pointer-events-none opacity-50'}
              onClick={() =>
                pagination.setPageIndex(
                  Math.min(pagination.pageCount - 1, pagination.pageIndex + 1),
                )
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
