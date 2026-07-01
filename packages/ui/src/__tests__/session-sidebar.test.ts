import type { SessionInfo } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { groupSessions, repositoryLabel } from '../shell/session-sidebar';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FIXTURE_DAY_START = localDayStartFromEpochDay(10000);

describe('session sidebar helpers', () => {
  it('groups sessions relative to the supplied local day', () => {
    const sessions = [
      createSession('today', FIXTURE_DAY_START + 10 * HOUR_MS),
      createSession('yesterday', FIXTURE_DAY_START - DAY_MS + 10 * HOUR_MS),
      createSession('earlier', FIXTURE_DAY_START - DAY_MS - HOUR_MS),
    ];

    expect(groupSessions(sessions, FIXTURE_DAY_START).map((group) => group.key)).toEqual([
      'today',
      'yesterday',
      'earlier',
    ]);
  });

  it('rolls today into yesterday when the local day changes', () => {
    const nextDayStart = FIXTURE_DAY_START + DAY_MS;
    const session = createSession('rolling', FIXTURE_DAY_START + 8 * HOUR_MS);

    expect(groupSessions([session], FIXTURE_DAY_START)[0]?.key).toBe('today');
    expect(groupSessions([session], nextDayStart)[0]?.key).toBe('yesterday');
  });

  it('uses the final path segment for POSIX and Windows repository labels', () => {
    const backslash = String.fromCodePoint(92);
    const windowsAppPath = ['C:', 'repo', 'app'].join(backslash);
    const windowsAppPathWithTrailingSeparator = `${windowsAppPath}${backslash}`;
    const windowsRoot = `C:${backslash}`;
    const uncProjectPath = `${backslash}${backslash}server${backslash}share${backslash}project`;

    expect(repositoryLabel('/home/user/projects/sample-repo')).toBe('sample-repo');
    expect(repositoryLabel('/home/user/projects/sample-repo/')).toBe('sample-repo');
    expect(repositoryLabel('/')).toBe('/');
    expect(repositoryLabel(windowsAppPath)).toBe('app');
    expect(repositoryLabel(windowsAppPathWithTrailingSeparator)).toBe('app');
    expect(repositoryLabel(windowsRoot)).toBe(windowsRoot);
    expect(repositoryLabel(uncProjectPath)).toBe('project');
  });
});

function createSession(sessionId: string, createdAt: number): SessionInfo {
  return {
    sessionId: sessionId as SessionInfo['sessionId'],
    kind: 'codex',
    cwd: '/workspace/sample-repo',
    status: 'idle',
    createdAt,
  };
}

function localDayStartFromEpochDay(day: number): number {
  const date = new Date(day * DAY_MS + 12 * HOUR_MS);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
