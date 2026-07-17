import { useGitDiff } from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { useTranslations } from 'use-intl';

/**
 * Uncommitted-diff stat chip beside the chrome title; renders nothing when there is no diff. Shares
 * the `useGitDiff(cwd, 'uncommitted')` SWR key with the Diff panel, so opening it never re-fetches.
 */
export function DiffStatChip({
  cwd,
  onOpenDiff,
}: {
  cwd: string | undefined;
  onOpenDiff: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.git.diff');
  const { data: diff } = useGitDiff(cwd, 'uncommitted');
  if (!diff || (diff.stat.additions === 0 && diff.stat.deletions === 0)) return null;

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onOpenDiff}
      className="pointer-events-auto shrink-0 gap-1.5 text-xs [-webkit-app-region:no-drag]"
    >
      {diff.stat.additions > 0 && (
        <span className="text-success-foreground">
          {t('additions', { count: diff.stat.additions })}
        </span>
      )}
      {diff.stat.deletions > 0 && (
        <span className="text-destructive-foreground">
          {t('deletions', { count: diff.stat.deletions })}
        </span>
      )}
    </Button>
  );
}
