import type { SessionId, SessionInfo } from '@linkcode/schema';

/** Sessions shown per group before "Show more" is toggled. */
export const DEFAULT_GROUP_PREVIEW_COUNT = 5;

export interface VisibleSessionsOptions {
  /** "Show more" has been toggled for this group. */
  expanded: boolean;
  activeId: SessionId | null;
  previewCount?: number;
}

export interface VisibleSessionsResult {
  sessions: SessionInfo[];
  /** Whether a Show more/Show less toggle should render. */
  hasOverflow: boolean;
}

/**
 * Selects which of a group's (pre-sorted) sessions render in the sidebar: the first
 * `previewCount` unless "Show more" is toggled, with the active session force-included past the
 * cutoff. Hiding a collapsed group is the accordion panel's job.
 */
export function selectVisibleSessions(
  sessions: readonly SessionInfo[],
  options: VisibleSessionsOptions,
): VisibleSessionsResult {
  const { expanded, activeId, previewCount = DEFAULT_GROUP_PREVIEW_COUNT } = options;

  const hasOverflow = sessions.length > previewCount;
  if (expanded || !hasOverflow) {
    return { sessions: [...sessions], hasOverflow };
  }

  const preview = sessions.filter(
    (session, index) => index < previewCount || session.sessionId === activeId,
  );
  return { sessions: preview, hasOverflow: true };
}
