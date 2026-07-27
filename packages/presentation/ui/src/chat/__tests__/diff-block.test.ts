import { describe, expect, it } from 'vitest';
import { chatFileDiff } from '../diff-block';
import type { DiffToolCallContent } from '../diff-utils';

function diff(content: Omit<DiffToolCallContent, 'type'>): DiffToolCallContent {
  return { type: 'diff', ...content };
}

describe('chatFileDiff', () => {
  it('recovers hunks from a headerless patch, the shape both adapters emit', () => {
    // codex forwards its app-server `unified_diff` verbatim and the claude adapter formats
    // `structuredPatch`; neither writes a `---`/`+++` preamble, and pierre parses zero hunks
    // without one — the card would render blank.
    const parsed = chatFileDiff(
      diff({
        change: 'modify',
        path: 'src/a.ts',
        patch: { format: 'git_patch', text: '@@ -26,3 +26,3 @@\n ctx\n-a\n+b' },
      }),
    );
    expect(parsed?.name).toBe('src/a.ts');
    expect(parsed?.type).toBe('change');
    expect(parsed?.hunks).toHaveLength(1);
    // The gutter number the issue is about: the edit sits at line 26, not line 1.
    expect(parsed?.hunks[0].additionStart).toBe(26);
  });

  it('keeps every hunk and its real line numbers from a git patch', () => {
    const parsed = chatFileDiff(
      diff({
        change: 'modify',
        path: 'src/a.ts',
        patch: {
          format: 'git_patch',
          text: [
            'diff --git a/src/a.ts b/src/a.ts',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -12,3 +12,3 @@',
            ' ctx',
            '-a',
            '+b',
            '@@ -84,2 +84,3 @@',
            ' tail',
            '+added',
          ].join('\n'),
        },
      }),
    );
    expect(parsed?.name).toBe('src/a.ts');
    expect(parsed?.hunks.map((hunk) => hunk.additionStart)).toEqual([12, 84]);
  });

  it('renders every supplied line when only the replaced region is available', () => {
    // oldText/newText are the region, not the file, so a finite context window would drop rows the
    // payload already carries. One hunk, everything in it.
    const parsed = chatFileDiff(
      diff({ change: 'modify', path: 'src/a.ts', oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' }),
    );
    expect(parsed?.type).toBe('change');
    expect(parsed?.hunks).toHaveLength(1);
    expect(parsed?.hunks[0].additionLines).toBe(1);
    expect(parsed?.hunks[0].deletionLines).toBe(1);
  });

  it('reads a whole-file write as an addition and a delete as a removal', () => {
    expect(chatFileDiff(diff({ change: 'add', path: 'new.ts', newText: 'x\ny\n' }))?.type).toBe(
      'new',
    );
    expect(chatFileDiff(diff({ change: 'delete', path: 'gone.ts', oldText: 'x\n' }))?.type).toBe(
      'deleted',
    );
  });

  it('detects a rename from the differing paths', () => {
    const parsed = chatFileDiff(
      diff({
        change: 'move',
        oldPath: 'old.ts',
        path: 'new.ts',
        oldText: 'a\n',
        newText: 'b\n',
      }),
    );
    expect(parsed?.prevName).toBe('old.ts');
    expect(parsed?.name).toBe('new.ts');
  });

  it('falls back to the text when a patch parses to nothing', () => {
    const parsed = chatFileDiff(
      diff({
        change: 'modify',
        path: 'src/a.ts',
        oldText: 'a\n',
        newText: 'b\n',
        patch: { format: 'git_patch', text: '' },
      }),
    );
    expect(parsed?.hunks).toHaveLength(1);
  });

  it.each([
    ['binary content', diff({ change: 'delete', path: 'logo.bin', isBinary: true })],
    ['a delete carrying no text', diff({ change: 'delete', path: 'gone.ts' })],
    ['an unchanged pair', diff({ change: 'modify', path: 'a.ts', oldText: 'x\n', newText: 'x\n' })],
  ])('draws nothing for %s', (_label, content) => {
    expect(chatFileDiff(content)).toBeNull();
  });
});
