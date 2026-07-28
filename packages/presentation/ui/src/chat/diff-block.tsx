import { cn } from '../lib/cn';
import type { ArtifactNavigation } from './artifacts/host-actions';
import type { DiffStats } from './diff-utils';
import { diffLines, patchLines } from './diff-utils';
import { FilePreviewCard } from './file-preview-card';

export function DiffCounter({
  className,
  stats,
}: {
  className?: string;
  stats: DiffStats;
}): React.ReactNode {
  if (stats.additions + stats.deletions === 0) return null;

  return (
    <span className={cn('flex shrink-0 items-center gap-1 font-mono text-xs', className)}>
      <span className="text-success-foreground">+{stats.additions}</span>
      <span className="text-destructive-foreground">-{stats.deletions}</span>
    </span>
  );
}

export function DiffBlock({
  path,
  oldPath,
  oldText,
  newText,
  patch,
  navigation,
}: {
  path: string;
  oldPath?: string;
  oldText?: string;
  newText?: string;
  patch?: string;
  navigation?: ArtifactNavigation | null;
}): React.ReactNode {
  const rows = patch === undefined ? diffLines(oldText ?? '', newText ?? '') : patchLines(patch);
  const stats = {
    additions: rows.filter((row) => row.type === 'add').length,
    deletions: rows.filter((row) => row.type === 'del').length,
  };
  return (
    <FilePreviewCard
      headerEnd={<DiffCounter className="ml-auto gap-1.5" stats={stats} />}
      label={oldPath ? `${oldPath} → ${path}` : undefined}
      navigation={navigation}
      panelClassName={
        rows.length > 0 ? 'overflow-x-auto p-0 font-mono text-xs leading-relaxed' : undefined
      }
      path={path}
    >
      {rows.length > 0
        ? rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                'whitespace-pre px-3',
                row.type === 'add' && 'bg-success/10 text-success-foreground',
                row.type === 'del' && 'bg-destructive/10 text-destructive-foreground',
                row.type === 'ctx' && 'text-muted-foreground',
              )}
            >
              <span className="select-none opacity-50">
                {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
              </span>
              {row.text}
            </div>
          ))
        : undefined}
    </FilePreviewCard>
  );
}
