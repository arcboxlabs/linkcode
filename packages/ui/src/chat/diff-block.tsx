import { createFixedArray } from 'foxact/create-fixed-array';
import { FileTextIcon } from 'lucide-react';
import { cn } from '../lib/cn';

interface DiffRow {
  id: string;
  type: 'add' | 'del' | 'ctx';
  text: string;
}

function diffLines(oldStr: string, newStr: string): DiffRow[] {
  // An empty side means zero lines (created / deleted file); ''.split('\n') would yield [''] — a phantom row.
  const oldLines = oldStr ? oldStr.split('\n') : [];
  const newLines = newStr ? newStr.split('\n') : [];
  const m = oldLines.length;
  const n = newLines.length;

  const lcs: number[][] = createFixedArray(m + 1).map(() => createFixedArray(n + 1).map(() => 0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const rows: DiffRow[] = [];
  const push = (type: DiffRow['type'], text: string): void => {
    rows.push({ id: String(rows.length), type, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      push('ctx', oldLines[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', oldLines[i]);
      i++;
    } else {
      push('add', newLines[j]);
      j++;
    }
  }
  while (i < m) {
    push('del', oldLines[i]);
    i++;
  }
  while (j < n) {
    push('add', newLines[j]);
    j++;
  }

  return rows;
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
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'del').length;

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-[12px]">
        <FileTextIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate font-mono text-muted-foreground">{path}</span>
        <span className="ml-auto flex gap-1.5">
          <span className="text-success-foreground">+{additions}</span>
          <span className="text-destructive-foreground">-{deletions}</span>
        </span>
      </div>
      <div className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
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
