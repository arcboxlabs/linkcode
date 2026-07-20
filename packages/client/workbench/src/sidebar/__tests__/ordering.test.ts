import type { SessionId, SessionInfo, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import type { ThreadGroup } from '@linkcode/ui';
import { describe, expect, it } from 'vitest';
import { applyThreadDrag, orderGroups, orderThreads } from '../ordering';

describe('orderGroups', () => {
  it('puts listed groups first in manual order, then unlisted in incoming order', () => {
    const groups = [createGroup('/a'), createGroup('/b'), createGroup('/c'), createGroup('/d')];

    const ordered = orderGroups(groups, ['/c', '/a']);

    expect(ordered.map((g) => g.collapseKey)).toEqual(['/c', '/a', '/b', '/d']);
  });

  it('ignores stale keys and leaves the order untouched when no key is listed', () => {
    const groups = [createGroup('/a'), createGroup('/b')];

    expect(orderGroups(groups, ['/gone']).map((g) => g.collapseKey)).toEqual(['/a', '/b']);
    expect(orderGroups(groups, []).map((g) => g.collapseKey)).toEqual(['/a', '/b']);
  });

  it('keeps the chat and unregistered fallback groups after the sortable project groups', () => {
    const chat = { ...createGroup('/home/LinkCode'), isChat: true };
    const fallback: ThreadGroup = {
      key: 'unregistered',
      collapseKey: 'unregistered',
      workspace: null,
      sessions: [],
      isChat: false,
      isPinned: false,
    };
    const groups = [chat, createGroup('/a'), createGroup('/b'), fallback];

    const ordered = orderGroups(groups, ['/b']);

    expect(ordered.map((g) => g.collapseKey)).toEqual([
      '/b',
      '/a',
      '/home/LinkCode',
      'unregistered',
    ]);
  });
});

describe('orderThreads', () => {
  const sessions = [
    createSession('s-4', 400),
    createSession('s-3', 300),
    createSession('s-2', 200),
    createSession('s-1', 100),
  ];

  it('partitions pinned first, keeping recency order, when there is no manual order', () => {
    const ordered = orderThreads(sessions, ids('s-1', 's-3'), []);

    expect(ordered.map((s) => s.sessionId)).toEqual(['s-3', 's-1', 's-4', 's-2']);
  });

  it('applies the manual order within each segment', () => {
    const ordered = orderThreads(sessions, ids('s-1', 's-3'), ids('s-1', 's-3', 's-2', 's-4'));

    expect(ordered.map((s) => s.sessionId)).toEqual(['s-1', 's-3', 's-2', 's-4']);
  });

  it('puts threads missing from the manual order first in their segment, by recency', () => {
    // s-4 and s-3 were created after the last drag wrote [s-1, s-2].
    const ordered = orderThreads(sessions, [], ids('s-1', 's-2'));

    expect(ordered.map((s) => s.sessionId)).toEqual(['s-4', 's-3', 's-1', 's-2']);
  });

  it('ignores pinned/manual ids that match no session', () => {
    const ordered = orderThreads(sessions, ids('gone'), ids('also-gone', 's-1'));

    expect(ordered.map((s) => s.sessionId)).toEqual(['s-4', 's-3', 's-2', 's-1']);
  });
});

describe('applyThreadDrag', () => {
  const orderedIds = ids('p-1', 'p-2', 'u-1', 'u-2', 'u-3');
  const pinnedIds = ids('p-1', 'p-2');

  it('reorders within the unpinned segment', () => {
    const next = applyThreadDrag({
      orderedIds,
      pinnedIds,
      activeId: id('u-3'),
      overId: id('u-1'),
      placement: 'before',
    });

    expect(next).toEqual(ids('p-1', 'p-2', 'u-3', 'u-1', 'u-2'));
  });

  it('respects after-placement', () => {
    const next = applyThreadDrag({
      orderedIds,
      pinnedIds,
      activeId: id('u-1'),
      overId: id('u-2'),
      placement: 'after',
    });

    expect(next).toEqual(ids('p-1', 'p-2', 'u-2', 'u-1', 'u-3'));
  });

  it('clamps an unpinned thread dropped above the pinned segment to the segment start', () => {
    const next = applyThreadDrag({
      orderedIds,
      pinnedIds,
      activeId: id('u-2'),
      overId: id('p-1'),
      placement: 'before',
    });

    expect(next).toEqual(ids('p-1', 'p-2', 'u-2', 'u-1', 'u-3'));
  });

  it('clamps a pinned thread dropped below the pinned segment to the segment end', () => {
    const next = applyThreadDrag({
      orderedIds,
      pinnedIds,
      activeId: id('p-1'),
      overId: id('u-3'),
      placement: 'after',
    });

    expect(next).toEqual(ids('p-2', 'p-1', 'u-1', 'u-2', 'u-3'));
  });

  it('returns null for a self-drop or an id not in the list', () => {
    expect(
      applyThreadDrag({
        orderedIds,
        pinnedIds,
        activeId: id('u-1'),
        overId: id('u-1'),
        placement: 'before',
      }),
    ).toBeNull();
    expect(
      applyThreadDrag({
        orderedIds,
        pinnedIds,
        activeId: id('gone'),
        overId: id('u-1'),
        placement: 'before',
      }),
    ).toBeNull();
    expect(
      applyThreadDrag({
        orderedIds,
        pinnedIds,
        activeId: id('u-1'),
        overId: id('gone'),
        placement: 'before',
      }),
    ).toBeNull();
  });
});

function id(value: string): SessionId {
  return value as SessionId;
}

function ids(...values: string[]): SessionId[] {
  return values.map(id);
}

function createSession(sessionId: string, createdAt: number): SessionInfo {
  return {
    sessionId: sessionId as SessionInfo['sessionId'],
    kind: 'codex',
    cwd: '/repo/app',
    status: 'idle',
    createdAt,
    updatedAt: createdAt,
  };
}

function createGroup(cwd: string): ThreadGroup {
  const workspace: WorkspaceRecord = {
    workspaceId: `ws${cwd}` as WorkspaceId,
    cwd,
    createdAt: 0,
    lastUsedAt: 0,
  };
  return {
    key: workspace.workspaceId,
    collapseKey: cwd,
    workspace,
    sessions: [],
    isChat: false,
    isPinned: false,
  };
}
