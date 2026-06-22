import { Button } from 'coss-ui/components/button';
import {
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  Pagination as UIPagination,
} from 'coss-ui/components/pagination';
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from 'coss-ui/components/select';
import { useMemo } from 'react';
import type { PaginationRender } from './use-pagination-render';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const pageSizeItems = PAGE_SIZE_OPTIONS.map((size) => ({ label: String(size), value: size }));

interface PaginationFooterProps {
  pagination: PaginationRender;
  /** Noun for the footer count, e.g. "machines", "runs". */
  rowNoun?: string;
}

export function PaginationFooter({ pagination, rowNoun = 'results' }: PaginationFooterProps) {
  const {
    pageIndex,
    pageSize,
    rowCount,
    canPreviousPage,
    canNextPage,
    range,
    pageRanges,
    setPageIndex,
    setPageSize,
    previousPage,
    nextPage,
  } = pagination;

  const pageRangeItems = useMemo(
    () => pageRanges.map((pageRange) => ({ label: `${pageRange.start}-${pageRange.end}`, value: pageRange.pageIndex })),
    [pageRanges],
  );

  if (rowCount <= 0) return null;

  return (
    <div className="px-5 py-3 min-h-14 border-t border-border flex items-center justify-between text-sm text-muted-foreground shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Select items={pageSizeItems} onValueChange={(value) => setPageSize(value!)} value={pageSize}>
            <SelectTrigger aria-label="Select page size" className="w-fit min-w-none" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {pageSizeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <p>per page</p>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <p>Viewing</p>
          <Select items={pageRangeItems} onValueChange={(value) => setPageIndex(value!)} value={pageIndex}>
            <SelectTrigger aria-label="Select result range" className="w-fit min-w-none" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {pageRangeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <p>
            of <strong className="font-medium text-foreground">{rowCount}</strong> {rowNoun}
          </p>
        </div>
      </div>
      <UIPagination className="justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              aria-disabled={!canPreviousPage}
              className={canPreviousPage ? '' : 'pointer-events-none opacity-50 cursor-not-allowed'}
              onClick={previousPage}
            />
          </PaginationItem>
          {range.map((item) =>
            item.type === 'ellipsis' ? (
              <PaginationItem key={item.key}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item.key}>
                <Button
                  aria-current={item.pageIndex === pageIndex ? 'page' : undefined}
                  onClick={() => setPageIndex(item.pageIndex)}
                  size="icon"
                  variant={item.pageIndex === pageIndex ? 'outline' : 'ghost'}
                >
                  {item.pageIndex + 1}
                </Button>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              aria-disabled={!canNextPage}
              className={canNextPage ? '' : 'pointer-events-none opacity-50 cursor-not-allowed'}
              onClick={nextPage}
            />
          </PaginationItem>
        </PaginationContent>
      </UIPagination>
    </div>
  );
}
