import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from 'coss-ui/components/pagination';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';

export function PromptPager({
  current,
  total,
  queued = 0,
  disabled = false,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
}: {
  current: number;
  total: number;
  queued?: number;
  disabled?: boolean;
  previousLabel?: string;
  nextLabel?: string;
  onPrevious: () => void;
  onNext: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.prompt');
  const hasPages = total > 1;
  const hasQueue = queued > 0;
  if (!hasPages && !hasQueue) return null;

  const previousDisabled = disabled || current <= 1;
  const nextDisabled = disabled || current >= total;

  return (
    <Pagination className="w-auto justify-end">
      <PaginationContent>
        {hasPages ? (
          <PaginationItem>
            <PaginationLink
              aria-label={previousLabel ?? t('previous')}
              aria-disabled={previousDisabled}
              className={cn(previousDisabled && 'pointer-events-none opacity-50')}
              href="#"
              size="icon-xs"
              tabIndex={previousDisabled ? -1 : 0}
              onClick={(event) => {
                event.preventDefault();
                if (!previousDisabled) onPrevious();
              }}
            >
              <ChevronLeftIcon />
            </PaginationLink>
          </PaginationItem>
        ) : null}
        <PaginationItem>
          <span
            aria-live="polite"
            className="flex h-6 items-center gap-1 text-muted-foreground text-xs tabular-nums"
            role="status"
          >
            {hasPages ? <span>{t('progress', { current, total })}</span> : null}
            {hasPages && hasQueue ? <span aria-hidden>·</span> : null}
            {hasQueue ? <span>{t('queued', { count: queued })}</span> : null}
          </span>
        </PaginationItem>
        {hasPages ? (
          <PaginationItem>
            <PaginationLink
              aria-label={nextLabel ?? t('next')}
              aria-disabled={nextDisabled}
              className={cn(nextDisabled && 'pointer-events-none opacity-50')}
              href="#"
              size="icon-xs"
              tabIndex={nextDisabled ? -1 : 0}
              onClick={(event) => {
                event.preventDefault();
                if (!nextDisabled) onNext();
              }}
            >
              <ChevronRightIcon />
            </PaginationLink>
          </PaginationItem>
        ) : null}
      </PaginationContent>
    </Pagination>
  );
}
