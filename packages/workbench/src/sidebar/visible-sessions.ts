import type { SessionId, SessionInfo } from '@linkcode/schema';

/** Sessions shown per group before "Show more" is toggled. */
export const DEFAULT_GROUP_PREVIEW_COUNT = 5;

export interface VisibleSessionsOptions {
  /** The group header is collapsed — only the active row (if any) stays visible. */
  collapsed: boolean;
  /** "Show more" has been toggled for this group. */
  expanded: boolean;
  activeId: SessionId | null;
  previewCount?: number;
}

export interface VisibleSessionsResult {
  sessions: SessionInfo[];
  /** Whether a Show more/Show less toggle should render. Always `false` while collapsed. */
  hasOverflow: boolean;
}

/**
 * Selects which of a group's sessions (already sorted, most recent first) render in the sidebar.
 * A collapsed group shows nothing but its own active session, if any — so switching sessions never
 * hides the one you're on. An expanded group previews the first `previewCount`, unless "Show more"
 * is toggled; the active session is force-included in the preview even past the cutoff.
 */
export function selectVisibleSessions(
  sessions: readonly SessionInfo[],
  options: VisibleSessionsOptions,
): VisibleSessionsResult {
  const { collapsed, expanded, activeId, previewCount = DEFAULT_GROUP_PREVIEW_COUNT } = options;

  if (collapsed) {
    const active = sessions.find((session) => session.sessionId === activeId);
    return { sessions: active ? [active] : [], hasOverflow: false };
  }

  const hasOverflow = sessions.length > previewCount;
  if (expanded || !hasOverflow) {
    return { sessions: [...sessions], hasOverflow };
  }

  const preview = sessions.filter(
    (session, index) => index < previewCount || session.sessionId === activeId,
  );
  return { sessions: preview, hasOverflow: true };
}
