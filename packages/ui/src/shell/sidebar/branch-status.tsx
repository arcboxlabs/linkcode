import type { GitStatus } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';

export interface BranchStatusProps {
  status: GitStatus | undefined;
  /** Show a dirty-file-count badge alongside the branch name (workspace rows, not group headers). */
  showDirty?: boolean;
  /** Leading icon; rendered only when there is a branch to show, so it never dangles. */
  icon?: React.ReactNode;
  className?: string;
}

export type BranchStatusComponentType = React.ComponentType<{
  cwd: string;
  showDirty?: boolean;
  icon?: React.ReactNode;
  className?: string;
}>;

/** Compact branch name (+ optional dirty-file badge) for a sidebar group header or workspace row. */
export function BranchStatus({
  status,
  showDirty = false,
  icon,
  className,
}: BranchStatusProps): React.ReactNode {
  const t = useTranslations('workbench.git');

  if (!status?.isRepo) return null;

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1 text-muted-foreground', className)}>
      {icon}
      <span className="truncate">{status.branch ?? t('detachedHead')}</span>
      {showDirty && status.dirtyFileCount > 0 && (
        <Badge size="sm" variant="warning">
          {t('dirtyCount', { count: status.dirtyFileCount })}
        </Badge>
      )}
    </span>
  );
}
