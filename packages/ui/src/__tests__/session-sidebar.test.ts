import { describe, expect, it } from 'vitest';
import { relativeTimeLabel } from '../shell/relative-time';
import { repositoryLabel } from '../shell/repository-label';

describe('repositoryLabel', () => {
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

describe('relativeTimeLabel', () => {
  const now = new Date(2024, 0, 15, 12, 0, 0).getTime();

  it('formats sub-minute differences in seconds', () => {
    expect(relativeTimeLabel(now - 30 * 1000, now, 'en-US')).toBe('30 seconds ago');
  });

  it('formats sub-hour differences in minutes', () => {
    expect(relativeTimeLabel(now - 5 * 60 * 1000, now, 'en-US')).toBe('5 minutes ago');
  });

  it('formats sub-day differences in hours', () => {
    expect(relativeTimeLabel(now - 3 * 60 * 60 * 1000, now, 'en-US')).toBe('3 hours ago');
  });

  it('formats sub-week differences in days', () => {
    expect(relativeTimeLabel(now - 2 * 24 * 60 * 60 * 1000, now, 'en-US')).toBe('2 days ago');
  });

  it('formats week-or-older differences in weeks', () => {
    expect(relativeTimeLabel(now - 14 * 24 * 60 * 60 * 1000, now, 'en-US')).toBe('2 weeks ago');
  });
});
