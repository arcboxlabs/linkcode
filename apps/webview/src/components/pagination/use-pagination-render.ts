import { createFixedArray } from 'foxact/create-fixed-array';
import { useCallback, useId, useMemo } from 'react';
import type { TablePaginationState } from '@/components/data-table/core/use-table-pagination-state';

/** `key` is unique and stable — use it directly as the React key when mapping. */
export type PaginationRangeItem = { type: 'ellipsis'; key: string } | { type: 'item'; key: string; pageIndex: number };

function buildPaginationRange(id: string, pageIndex: number, pageCount: number): PaginationRangeItem[] {
  const current = pageIndex + 1;
  const total = pageCount;

  // The layout has at most one ellipsis on each side of the current-page window,
  // so leading/trailing make semantic, stable keys (no array index needed).
  const item = (page: number): PaginationRangeItem => ({
    type: 'item',
    key: `${id}-${page}`,
    pageIndex: page - 1,
  });
  const leadingEllipsis: PaginationRangeItem = { type: 'ellipsis', key: `${id}-ellipsis-leading` };
  const trailingEllipsis: PaginationRangeItem = { type: 'ellipsis', key: `${id}-ellipsis-trailing` };

  if (total <= 7) {
    return createFixedArray(total).map((_, i) => item(i + 1));
  }
  if (current <= 4) {
    return [item(1), item(2), item(3), item(4), item(5), trailingEllipsis, item(total)];
  }
  if (current >= total - 3) {
    return [item(1), leadingEllipsis, item(total - 4), item(total - 3), item(total - 2), item(total - 1), item(total)];
  }
  return [item(1), leadingEllipsis, item(current - 1), item(current), item(current + 1), trailingEllipsis, item(total)];
}

/**
 * Derived pagination view, mounted BELOW the data-fetching hook — this is where
 * the server-provided page count joins the raw pagination state (the same split
 * TanStack Table achieves with controlled state + `pageCount` in its options).
 * For future front-end pagination, this is also the seam where a locally
 * computed page count would be fed in instead.
 *
 * State fields and derived fields are getters delegating to the tracked state
 * instance: reading a field during render subscribes the component to exactly
 * the state it depends on. Read fields directly off the instance — never spread
 * it or copy fields into a new object, that snapshots current values and breaks
 * the getter-based tracking.
 */
export interface PaginationPageRange {
  pageIndex: number;
  /** 1-based ordinal of the first row on this page. */
  start: number;
  /** 1-based ordinal of the last row on this page. */
  end: number;
}

export interface PaginationRender {
  readonly pageIndex: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly rowCount: number;
  /** Derived: whether a previous page exists. */
  readonly canPreviousPage: boolean;
  /** Derived: whether a next page exists. */
  readonly canNextPage: boolean;
  /**
   * Derived: the page stepper layout (first/last always visible, ellipses in
   * between) — map it straight to the pagination UI.
   */
  readonly range: PaginationRangeItem[];
  /**
   * Derived: per-page row ranges ("rows 26–50 are page 2") — map it straight to
   * a page-jump select. Label formatting is left to the renderer.
   */
  readonly pageRanges: PaginationPageRange[];
  setPageIndex: (pageIndex: number) => void;
  setPageSize: (pageSize: number) => void;
  firstPage: () => void;
  /** Go to the previous page, clamped at the first page. */
  previousPage: () => void;
  /** Go to the next page, clamped at the last page. */
  nextPage: () => void;
}

interface UsePaginationRenderOptions {
  /** The pagination state instance this view derives from. */
  pagination: TablePaginationState;
  /** Total page count, from the server response (or computed locally for front-end pagination). */
  pageCount: number;
  /** Total row count across all pages, from the server response (or the local array length). */
  rowCount: number;
}

export function usePaginationRender({ pagination, pageCount, rowCount }: UsePaginationRenderOptions): PaginationRender {
  // namespaces the range item keys so multiple tables on one page never collide
  const id = useId();

  const previousPage = useCallback(() => {
    // reading the tracked getter in an event handler returns the latest value
    pagination.setPageIndex(Math.max(0, pagination.pageIndex - 1));
  }, [pagination]);

  const nextPage = useCallback(() => {
    pagination.setPageIndex(Math.min(Math.max(0, pageCount - 1), pagination.pageIndex + 1));
  }, [pagination, pageCount]);

  // The instance only recreates when pageCount/rowCount change (state and actions
  // are referentially stable). Everything reading live state goes through getters,
  // so values stay current AND reads register render dependencies.
  return useMemo(
    () => ({
      pageCount,
      rowCount,
      get pageIndex() {
        return pagination.pageIndex;
      },
      get pageSize() {
        return pagination.pageSize;
      },
      get canPreviousPage() {
        return pagination.pageIndex > 0;
      },
      get canNextPage() {
        return pagination.pageIndex < pageCount - 1;
      },
      get range() {
        return buildPaginationRange(id, pagination.pageIndex, pageCount);
      },
      get pageRanges() {
        const { pageSize } = pagination;
        return createFixedArray(pageCount).map((_, i) => ({
          pageIndex: i,
          start: i * pageSize + 1,
          end: Math.min((i + 1) * pageSize, rowCount),
        }));
      },
      setPageIndex: pagination.setPageIndex,
      setPageSize: pagination.setPageSize,
      firstPage: pagination.firstPage,
      previousPage,
      nextPage,
    }),
    [id, pagination, pageCount, rowCount, previousPage, nextPage],
  );
}
