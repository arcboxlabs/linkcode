import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { TurnVersion } from './types';

/** `‹ 1/N ›` between a turn's sibling versions, plus a badge when the turn did not complete. */
export function TurnVersionNav({
  version,
  onSelect,
}: {
  version: TurnVersion;
  onSelect?: (direction: -1 | 1) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.message');
  return (
    <span
      className="flex items-center gap-1 text-muted-foreground text-xs tabular-nums"
      data-slot="turn-version-nav"
    >
      {version.count > 1 ? (
        <>
          <Button
            aria-label={t('versionPrevious')}
            disabled={version.index <= 1 || onSelect === undefined}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => onSelect?.(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span>{t('versionOf', { index: version.index, count: version.count })}</span>
          <Button
            aria-label={t('versionNext')}
            disabled={version.index >= version.count || onSelect === undefined}
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => onSelect?.(1)}
          >
            <ChevronRightIcon />
          </Button>
        </>
      ) : null}
      {version.state === null ? null : (
        <Badge size="sm" variant={version.state === 'failed' ? 'error' : 'secondary'}>
          {t(version.state === 'failed' ? 'turnFailed' : 'turnCancelled')}
        </Badge>
      )}
    </span>
  );
}
