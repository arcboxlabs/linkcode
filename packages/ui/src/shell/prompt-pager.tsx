import { Button } from 'coss-ui/components/button';
import { Pagination, PaginationContent, PaginationItem } from 'coss-ui/components/pagination';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

export function PromptPager({
  current,
  total,
  queued = 0,
  disabled = false,
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
}: {
  current: number;
  total: number;
  queued?: number;
  disabled?: boolean;
  label?: string;
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
  const isNextDisabled = disabled || current >= total;

  return (
    <Pagination aria-label={label} className="w-auto justify-end">
      <PaginationContent>
        {hasPages ? (
          <PaginationItem>
            <Button
              aria-label={previousLabel ?? t('previous')}
              disabled={previousDisabled}
              size="icon-xs"
              variant="ghost"
              onClick={onPrevious}
            >
              <ChevronLeftIcon />
            </Button>
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
            <Button
              aria-label={nextLabel ?? t('next')}
              disabled={isNextDisabled}
              size="icon-xs"
              variant="ghost"
              onClick={onNext}
            >
              <ChevronRightIcon />
            </Button>
          </PaginationItem>
        ) : null}
      </PaginationContent>
    </Pagination>
  );
}
