import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { diffStats, patchLines, toolCallDiffStats } from '../chat/diff-utils';

describe('diffStats', () => {
  it('does not count a file content trailing newline as an extra line', () => {
    // A created one-line file "added\n" is a single added line, not two.
    expect(diffStats('', 'added\n')).toEqual({ additions: 1, deletions: 0 });
    expect(diffStats('removed\n', '')).toEqual({ additions: 0, deletions: 1 });
  });

  it('counts additions and deletions without a trailing-newline inflation', () => {
    expect(diffStats('a\nb\n', 'a\nc\n')).toEqual({ additions: 1, deletions: 1 });
  });

  it('treats an undefined old side as a fresh file (all additions)', () => {
    expect(diffStats(undefined, 'x\ny\n')).toEqual({ additions: 2, deletions: 0 });
  });

  it('prefers a git patch and ignores its file and hunk headers', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      ' same',
      '-before',
      '+after',
    ].join('\n');
    expect(patchLines(patch).map(({ type, text }) => ({ type, text }))).toEqual([
      { type: 'ctx', text: 'same' },
      { type: 'del', text: 'before' },
      { type: 'add', text: 'after' },
    ]);
    expect(diffStats(undefined, undefined, patch)).toEqual({ additions: 1, deletions: 1 });
  });
});

describe('toolCallDiffStats', () => {
  it('sums every structured diff while ignoring non-diff content', () => {
    const toolCall: Pick<ToolCall, 'content'> = {
      content: [
        { type: 'diff', path: 'a.ts', oldText: 'old\n', newText: 'new\n' },
        { type: 'content', content: { type: 'text', text: 'Edited two files.' } },
        {
          type: 'diff',
          change: 'modify',
          path: 'b.ts',
          patch: { format: 'git_patch', text: '@@ -0,0 +1,2 @@\n+one\n+two' },
        },
      ],
    };

    expect(toolCallDiffStats(toolCall)).toEqual({ additions: 3, deletions: 1 });
  });
});
