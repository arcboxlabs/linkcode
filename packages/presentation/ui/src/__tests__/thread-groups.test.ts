import type {
  SessionId,
  SessionInfo,
  WorkspaceId,
  WorkspaceKind,
  WorkspaceRecord,
} from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  extractPinnedGroup,
  groupThreadsByWorkspace,
  PINNED_THREAD_GROUP_KEY,
  UNREGISTERED_THREAD_GROUP_KEY,
  withoutAutomationSessions,
} from '../thread-groups';

describe('groupThreadsByWorkspace', () => {
  it('aligns sessions to workspaces via normalizeCwdKey, ignoring a trailing separator', () => {
    const workspace = createWorkspace('ws-1', '/repo/app', 1);
    const session = createSession('s-1', '/repo/app/', 100);

    const groups = groupThreadsByWorkspace([session], [workspace]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.workspace?.workspaceId).toBe('ws-1');
    expect(groups[0]?.sessions).toEqual([session]);
    expect(groups[0]?.collapseKey).toBe('/repo/app');
  });

  it('sorts sessions within a group by createdAt descending', () => {
    const workspace = createWorkspace('ws-1', '/repo/app', 1);
    const older = createSession('s-old', '/repo/app', 100);
    const newer = createSession('s-new', '/repo/app', 200);

    const groups = groupThreadsByWorkspace([older, newer], [workspace]);

    expect(groups[0]?.sessions.map((s) => s.sessionId)).toEqual(['s-new', 's-old']);
  });

  it('orders groups by workspace.lastUsedAt descending', () => {
    const stale = createWorkspace('ws-stale', '/repo/stale', 1);
    const fresh = createWorkspace('ws-fresh', '/repo/fresh', 2);
    const staleSession = createSession('s-stale', '/repo/stale', 100);
    const freshSession = createSession('s-fresh', '/repo/fresh', 50);

    const groups = groupThreadsByWorkspace([staleSession, freshSession], [stale, fresh]);

    expect(groups.map((g) => g.key)).toEqual(['ws-fresh', 'ws-stale']);
  });

  it('buckets sessions matching no workspace into one fallback group, always last', () => {
    const fresh = createWorkspace('ws-fresh', '/repo/fresh', 2);
    const freshSession = createSession('s-fresh', '/repo/fresh', 50);
    const strays = [
      createSession('s-stray-1', '/tmp/scratch', 500),
      createSession('s-stray-2', '/tmp/other', 10),
    ];

    const groups = groupThreadsByWorkspace([freshSession, ...strays], [fresh]);

    expect(groups.map((g) => g.key)).toEqual(['ws-fresh', UNREGISTERED_THREAD_GROUP_KEY]);
    const fallback = groups.at(-1);
    expect(fallback?.workspace).toBeNull();
    expect(fallback?.collapseKey).toBe(UNREGISTERED_THREAD_GROUP_KEY);
    expect(fallback?.sessions.map((s) => s.sessionId)).toEqual(['s-stray-1', 's-stray-2']);
  });

  it('includes a registered workspace with no matching sessions, as an empty group', () => {
    const empty = createWorkspace('ws-empty', '/repo/empty', 1);
    const used = createWorkspace('ws-used', '/repo/used', 2);
    const session = createSession('s-1', '/repo/used', 100);

    const groups = groupThreadsByWorkspace([session], [empty, used]);

    expect(groups.map((g) => g.key)).toEqual(['ws-used', 'ws-empty']);
    expect(groups.find((g) => g.key === 'ws-empty')?.sessions).toEqual([]);
  });

  it('marks the chat-kind workspace group isChat, and every other group (incl. unregistered) false', () => {
    const project = createWorkspace('ws-project', '/repo/app', 1);
    const chat = createWorkspace('ws-chat', '/home/LinkCode', 2, 'chat');
    const strayCwd = '/tmp/scratch';

    const groups = groupThreadsByWorkspace(
      [createSession('s-stray', strayCwd, 10)],
      [project, chat],
    );

    expect(groups.find((g) => g.key === 'ws-chat')?.isChat).toBe(true);
    expect(groups.find((g) => g.key === 'ws-project')?.isChat).toBe(false);
    expect(groups.find((g) => g.key === UNREGISTERED_THREAD_GROUP_KEY)?.isChat).toBe(false);
    expect(groups.every((g) => !g.isPinned)).toBe(true);
  });
});

describe('extractPinnedGroup', () => {
  const sessions = [
    createSession('s-1', '/repo/app', 300),
    createSession('s-2', '/repo/app', 200),
    createSession('s-3', '/repo/other', 100),
  ];
  const ids = (list: readonly string[]): SessionId[] => list as SessionId[];

  it('splits pinned sessions into the synthetic group, ordered by pin recency', () => {
    const { pinnedGroup, rest } = extractPinnedGroup(sessions, ids(['s-3', 's-1']));

    expect(pinnedGroup?.key).toBe(PINNED_THREAD_GROUP_KEY);
    expect(pinnedGroup?.collapseKey).toBe(PINNED_THREAD_GROUP_KEY);
    expect(pinnedGroup?.workspace).toBeNull();
    expect(pinnedGroup?.isChat).toBe(false);
    expect(pinnedGroup?.isPinned).toBe(true);
    expect(pinnedGroup?.sessions.map((s) => s.sessionId)).toEqual(['s-3', 's-1']);
    expect(rest.map((s) => s.sessionId)).toEqual(['s-2']);
  });

  it('ignores pinned ids matching no session', () => {
    const { pinnedGroup, rest } = extractPinnedGroup(sessions, ids(['s-gone', 's-2']));

    expect(pinnedGroup?.sessions.map((s) => s.sessionId)).toEqual(['s-2']);
    expect(rest.map((s) => s.sessionId)).toEqual(['s-1', 's-3']);
  });

  it('returns no group and every session when nothing matches', () => {
    expect(extractPinnedGroup(sessions, [])).toEqual({ pinnedGroup: null, rest: sessions });
    expect(extractPinnedGroup(sessions, ids(['s-gone'])).pinnedGroup).toBeNull();
  });
});

describe('withoutAutomationSessions', () => {
  it('drops sessions tagged by an automation and keeps the rest', () => {
    const plain = createSession('s-1', '/repo', 1);
    const loop = {
      ...createSession('s-2', '/repo', 2),
      automation: { kind: 'loop', id: 'lp-1' },
    } satisfies SessionInfo;
    const schedule = {
      ...createSession('s-3', '/repo', 3),
      automation: { kind: 'schedule', id: 'sch-1' },
    } satisfies SessionInfo;

    expect(withoutAutomationSessions([plain, loop, schedule])).toEqual([plain]);
  });
});

function createSession(sessionId: string, cwd: string, createdAt: number): SessionInfo {
  return {
    sessionId: sessionId as SessionInfo['sessionId'],
    kind: 'codex',
    cwd,
    status: 'idle',
    createdAt,
    updatedAt: createdAt,
  };
}

function createWorkspace(
  workspaceId: string,
  cwd: string,
  lastUsedAt: number,
  kind?: WorkspaceKind,
): WorkspaceRecord {
  return {
    workspaceId: workspaceId as WorkspaceId,
    cwd,
    kind,
    createdAt: 0,
    lastUsedAt,
  };
}
