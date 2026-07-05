import { createFixedArray } from 'foxact/create-fixed-array';

interface DiffRow {
  id: string;
  type: 'add' | 'del' | 'ctx';
  text: string;
}

export function diffLines(oldStr: string, newStr: string): DiffRow[] {
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

/** Line-level add/delete counts for a diff, shared with group headers that sum across files. */
export function diffStats(
  oldText: string | undefined,
  newText: string,
): { additions: number; deletions: number } {
  const rows = diffLines(oldText ?? '', newText);
  return {
    additions: rows.filter((row) => row.type === 'add').length,
    deletions: rows.filter((row) => row.type === 'del').length,
  };
}
