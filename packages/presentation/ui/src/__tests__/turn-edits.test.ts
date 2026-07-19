import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { advanceTurnSegments, splitTurnSegments, turnFileEdits } from '../chat/turn-edits';
import type { ConversationItem } from '../chat/types';

function user(turnId: string | null, id: string): ConversationItem {
  return { kind: 'message', id, turnId, role: 'user', blocks: [], isStreaming: false };
}

function tool(
  turnId: string | null,
  id: string,
  status: ToolCall['status'],
  diffs: Array<{ path: string; oldText?: string; newText: string }> = [],
): ConversationItem {
  return {
    kind: 'tool',
    id,
    turnId,
    toolCall: {
      toolCallId: id,
      title: id,
      kind: 'edit',
      status,
      content: diffs.map((diff) => ({ type: 'diff', ...diff })),
    },
  };
}

describe('turn edit selectors', () => {
  it('splits the timeline into consecutive turn segments', () => {
    const leadIn = tool(null, 'seeded', 'completed');
    const firstUser = user('turn-1', 'u1');
    const firstTool = tool('turn-1', 't1', 'completed');
    const secondUser = user('turn-2', 'u2');

    expect(splitTurnSegments([leadIn, firstUser, firstTool, secondUser])).toEqual([
      { turnId: null, items: [leadIn] },
      { turnId: 'turn-1', items: [firstUser, firstTool] },
      { turnId: 'turn-2', items: [secondUser] },
    ]);
  });

  it('aggregates completed diffs per file and sums totals', () => {
    const edits = turnFileEdits([
      tool('turn-1', 't1', 'completed', [
        { path: 'a.ts', oldText: 'one\ntwo\n', newText: 'one\nthree\n' },
      ]),
      tool('turn-1', 't2', 'completed', [
        { path: 'a.ts', newText: 'added\n' },
        { path: 'b.ts', oldText: 'gone\n', newText: '' },
      ]),
    ]);

    expect(edits).toEqual({
      files: [
        { path: 'a.ts', additions: 2, deletions: 1 },
        { path: 'b.ts', additions: 0, deletions: 1 },
      ],
      additions: 2,
      deletions: 2,
    });
  });

  it('ignores non-completed calls and returns null when nothing was edited', () => {
    expect(
      turnFileEdits([
        tool('turn-1', 'failed', 'failed', [{ path: 'a.ts', newText: 'x\n' }]),
        tool('turn-1', 'running', 'in_progress', [{ path: 'b.ts', newText: 'y\n' }]),
        user('turn-1', 'u1'),
      ]),
    ).toBeNull();
    expect(turnFileEdits([tool('turn-1', 'no-diff', 'completed')])).toBeNull();
  });
});

describe('advanceTurnSegments', () => {
  const u1 = user('turn-1', 'u1');
  const t1 = tool('turn-1', 't1', 'completed');
  const u2 = user('turn-2', 'u2');
  const t2 = tool('turn-2', 't2', 'in_progress');

  it('matches splitTurnSegments without a previous snapshot', () => {
    expect(advanceTurnSegments(null, [u1, t1, u2])).toEqual(splitTurnSegments([u1, t1, u2]));
  });

  it('returns the previous segments array for identical items', () => {
    const items = [u1, t1, u2];
    const segments = advanceTurnSegments(null, items);
    expect(advanceTurnSegments({ items, segments }, items)).toBe(segments);
  });

  it('keeps the segments array identity when a new items array has unchanged references', () => {
    const items = [u1, t1, u2, t2];
    const segments = advanceTurnSegments(null, items);
    expect(advanceTurnSegments({ items, segments }, [...items])).toBe(segments);
  });

  it('reuses settled segment objects when the active turn grows', () => {
    const items = [u1, t1, u2];
    const segments = advanceTurnSegments(null, items);
    const next = [u1, t1, u2, t2];
    const advanced = advanceTurnSegments({ items, segments }, next);

    expect(advanced).toEqual(splitTurnSegments(next));
    expect(advanced[0]).toBe(segments[0]);
    expect(advanced[1]).not.toBe(segments[1]);
  });

  it('rebuilds the boundary segment when a new turn opens', () => {
    const items = [u1, t1];
    const segments = advanceTurnSegments(null, items);
    const next = [u1, t1, u2, t2];
    const advanced = advanceTurnSegments({ items, segments }, next);

    expect(advanced).toEqual(splitTurnSegments(next));
    expect(advanced[0]).toBe(segments[0]);
  });

  it('reuses segments below an in-place item replacement and rebuilds from it', () => {
    const t2Done = tool('turn-2', 't2', 'completed');
    const items = [u1, t1, u2, t2];
    const segments = advanceTurnSegments(null, items);
    const next = [u1, t1, u2, t2Done];
    const advanced = advanceTurnSegments({ items, segments }, next);

    expect(advanced).toEqual(splitTurnSegments(next));
    expect(advanced[0]).toBe(segments[0]);
    expect(advanced[1]).not.toBe(segments[1]);
  });

  it('rebuilds everything for an unrelated timeline', () => {
    const items = [u1, t1];
    const segments = advanceTurnSegments(null, items);
    const other = [user('turn-9', 'u9')];

    expect(advanceTurnSegments({ items, segments }, other)).toEqual(splitTurnSegments(other));
  });

  it('handles a shrunken timeline (items removed from the tail)', () => {
    const items = [u1, t1, u2, t2];
    const segments = advanceTurnSegments(null, items);
    const next = [u1, t1];
    const advanced = advanceTurnSegments({ items, segments }, next);

    expect(advanced).toEqual(splitTurnSegments(next));
  });
});
