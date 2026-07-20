import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { diffStats, toolCallDiffStats } from '../chat/diff-utils';

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
});

describe('toolCallDiffStats', () => {
  it('sums every structured diff while ignoring non-diff content', () => {
    const toolCall: Pick<ToolCall, 'content'> = {
      content: [
        { type: 'diff', path: 'a.ts', oldText: 'old\n', newText: 'new\n' },
        { type: 'content', content: { type: 'text', text: 'Edited two files.' } },
        { type: 'diff', path: 'b.ts', newText: 'one\ntwo\n' },
      ],
    };

    expect(toolCallDiffStats(toolCall)).toEqual({ additions: 3, deletions: 1 });
  });
});
