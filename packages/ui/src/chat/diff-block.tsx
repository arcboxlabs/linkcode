import { FileTextIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { diffLines } from './diff-utils';

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
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'del').length;

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/32 px-3 py-1.5 text-xs">
        <FileTextIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-muted-foreground">{path}</span>
        <span className="ml-auto flex gap-1.5">
          <span className="text-success-foreground">+{additions}</span>
          <span className="text-destructive-foreground">-{deletions}</span>
        </span>
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
