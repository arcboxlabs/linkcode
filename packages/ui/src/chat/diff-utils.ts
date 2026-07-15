import type { ToolCall } from '@linkcode/schema';
import { createFixedArray } from 'foxact/create-fixed-array';

interface DiffRow {
  id: string;
  type: 'add' | 'del' | 'ctx';
  text: string;
}

// A file's content normally ends in a newline; splitting on '\n' would then yield a trailing empty
// element that counts as a phantom extra line (e.g. "added\n" → 2 lines). Strip one trailing newline.
const TRAILING_NEWLINE_RE = /\n$/;

export function diffLines(oldStr: string, newStr: string): DiffRow[] {
  // An empty side means zero lines (created / deleted file); ''.split('\n') would yield [''] — a phantom row.
  const oldLines = oldStr ? oldStr.replace(TRAILING_NEWLINE_RE, '').split('\n') : [];
  const newLines = newStr ? newStr.replace(TRAILING_NEWLINE_RE, '').split('\n') : [];
  const m = oldLines.length;
  const n = newLines.length;

  // The LCS DP matrix is O(m*n) cells; a multi-thousand-line diff (e.g. 1000x1000) would allocate
  // millions of entries on every render. Above ~250k cells, skip the alignment and fall back to a
  // trivial diff (all old lines removed, all new lines added).
  if (m * n > 250000) {
    const rows: DiffRow[] = [];
    for (let i = 0; i < m; i++) {
      rows.push({ id: String(rows.length), type: 'del', text: oldLines[i] });
    }
    for (let j = 0; j < n; j++) {
      rows.push({ id: String(rows.length), type: 'add', text: newLines[j] });
    }
    return rows;
  }

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
export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStats(oldText: string | undefined, newText: string): DiffStats {
  const rows = diffLines(oldText ?? '', newText);
  return {
    additions: rows.filter((row) => row.type === 'add').length,
    deletions: rows.filter((row) => row.type === 'del').length,
  };
}

export function toolCallDiffStats(toolCall: Pick<ToolCall, 'content'>): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const content of toolCall.content) {
    if (content.type !== 'diff') continue;
    const stats = diffStats(content.oldText, content.newText);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { additions, deletions };
}
