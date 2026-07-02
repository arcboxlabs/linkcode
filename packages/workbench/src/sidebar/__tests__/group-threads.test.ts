import type { SessionInfo, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { groupThreadsByWorkspace, UNREGISTERED_THREAD_GROUP_KEY } from '../group-threads';

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
});

function createSession(sessionId: string, cwd: string, createdAt: number): SessionInfo {
  return {
    sessionId: sessionId as SessionInfo['sessionId'],
    kind: 'codex',
    cwd,
    status: 'idle',
    createdAt,
  };
}

function createWorkspace(workspaceId: string, cwd: string, lastUsedAt: number): WorkspaceRecord {
  return {
    workspaceId: workspaceId as WorkspaceId,
    cwd,
    createdAt: 0,
    lastUsedAt,
  };
}
