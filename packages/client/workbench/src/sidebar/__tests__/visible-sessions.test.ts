import type { SessionId, SessionInfo } from '@linkcode/schema';
import { createFixedArray } from 'foxts/create-fixed-array';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUP_PREVIEW_COUNT, selectVisibleSessions } from '../visible-sessions';

describe('selectVisibleSessions', () => {
  it('returns every session when the count is within the preview', () => {
    const sessions = makeSessions(3);

    const result = selectVisibleSessions(sessions, {
      expanded: false,
      activeId: null,
    });

    expect(result.sessions).toEqual(sessions);
    expect(result.hasOverflow).toBe(false);
  });

  it('truncates to the preview count when not expanded', () => {
    const sessions = makeSessions(8);

    const result = selectVisibleSessions(sessions, {
      expanded: false,
      activeId: null,
    });

    expect(result.sessions.map((s) => s.sessionId)).toEqual(
      sessions.slice(0, DEFAULT_GROUP_PREVIEW_COUNT).map((s) => s.sessionId),
    );
    expect(result.hasOverflow).toBe(true);
  });

  it('force-includes the active session even past the preview cutoff', () => {
    const sessions = makeSessions(8);
    const activeId = sessions[7].sessionId;

    const result = selectVisibleSessions(sessions, {
      expanded: false,
      activeId,
    });

    expect(result.sessions.map((s) => s.sessionId)).toEqual([
      ...sessions.slice(0, DEFAULT_GROUP_PREVIEW_COUNT).map((s) => s.sessionId),
      activeId,
    ]);
    expect(result.hasOverflow).toBe(true);
  });

  it('does not duplicate the active session when it is already within the preview', () => {
    const sessions = makeSessions(8);
    const activeId = sessions[0].sessionId;

    const result = selectVisibleSessions(sessions, {
      expanded: false,
      activeId,
    });

    expect(result.sessions).toHaveLength(DEFAULT_GROUP_PREVIEW_COUNT);
  });

  it('returns every session once expanded ("Show more" toggled), independent of other groups', () => {
    const sessions = makeSessions(8);

    const truncatedPreview = selectVisibleSessions(sessions, {
      expanded: false,
      activeId: null,
    });
    const expandedPreview = selectVisibleSessions(sessions, {
      expanded: true,
      activeId: null,
    });

    expect(truncatedPreview.sessions).toHaveLength(DEFAULT_GROUP_PREVIEW_COUNT);
    expect(expandedPreview.sessions).toEqual(sessions);
    expect(expandedPreview.hasOverflow).toBe(true);
  });

  it('respects a custom previewCount', () => {
    const sessions = makeSessions(4);

    const result = selectVisibleSessions(sessions, {
      expanded: false,
      activeId: null,
      previewCount: 2,
    });

    expect(result.sessions).toHaveLength(2);
    expect(result.hasOverflow).toBe(true);
  });
});

function makeSessions(count: number): SessionInfo[] {
  return createFixedArray(count).map((index) => ({
    sessionId: `s-${index}` as SessionId,
    kind: 'codex',
    cwd: '/repo',
    status: 'idle',
    createdAt: 1000 - index,
    updatedAt: 1000 - index,
  }));
}
