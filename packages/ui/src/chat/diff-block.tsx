import { Button } from 'coss-ui/components/button';
import { Card, CardHeader, CardPanel } from 'coss-ui/components/card';
import { FileTextIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { useArtifactHostActions } from './artifacts/context';
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
  const t = useTranslations('workbench.artifact');
  const openFile = useArtifactHostActions()?.openFile;
  const rows = diffLines(oldText ?? '', newText);
  const stats = {
    additions: rows.filter((row) => row.type === 'add').length,
    deletions: rows.filter((row) => row.type === 'del').length,
  };
  const header = (
    <>
      <FileTextIcon className="size-3.5 text-muted-foreground" />
      <span className="min-w-0 truncate font-mono text-muted-foreground">{path}</span>
      <DiffCounter className="ml-auto gap-1.5" stats={stats} />
    </>
  );

  return (
    <Card className="my-1 overflow-hidden">
      <CardHeader className="grid-cols-1 grid-rows-[auto] border-b bg-muted/32 p-0">
        {openFile ? (
          <Button
            className="w-full justify-start rounded-none border-0 px-3 font-normal text-xs sm:text-xs"
            size="sm"
            title={t('openFile')}
            variant="ghost"
            onClick={() => openFile(path)}
          >
            {header}
          </Button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs">{header}</div>
        )}
      </CardHeader>
      <CardPanel className="overflow-x-auto p-0 font-mono text-xs leading-relaxed">
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
      </CardPanel>
    </Card>
  );
}
