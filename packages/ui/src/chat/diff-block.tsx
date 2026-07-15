import { FileTextIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import type { DiffStats } from './diff-utils';
import { diffLines } from './diff-utils';

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
  oldText,
  newText,
}: {
  path: string;
  oldText?: string;
  newText: string;
}): React.ReactNode {
  const rows = diffLines(oldText ?? '', newText);
  const stats = {
    additions: rows.filter((row) => row.type === 'add').length,
    deletions: rows.filter((row) => row.type === 'del').length,
  };

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/32 px-3 py-1.5 text-xs">
        <FileTextIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-muted-foreground">{path}</span>
        <DiffCounter className="ml-auto gap-1.5" stats={stats} />
      </div>
      <div className="overflow-x-auto font-mono text-xs leading-relaxed">
        {rows.map((row) => (
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
        ))}
      </div>
    </div>
  );
}
