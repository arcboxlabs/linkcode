import { zodPersist } from '@linkcode/common/zustand';
import type { SessionId, SessionInfo } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedPinnedThreadsSchema = z
  .object({
    pinnedSessionIds: z.array(SessionIdSchema),
  })
  .partial();
type PersistedPinnedThreads = z.infer<typeof PersistedPinnedThreadsSchema>;

export interface SidebarPinState {
  /** Session ids pinned to the top of their group, most recently pinned first. */
  pinnedSessionIds: SessionId[];
  togglePinned: (id: SessionId) => void;
}

/**
 * Persists which threads are pinned in the sidebar. Ids of sessions that no longer exist are
 * harmless — they simply match nothing when ordering — so the store never prunes.
 */
export const useSidebarPinStore = create<SidebarPinState>()(
  zodPersist<SidebarPinState, [], [], PersistedPinnedThreads, PersistedPinnedThreads>(
    (set) => ({
      pinnedSessionIds: [],
      togglePinned: (id) =>
        set((state) => ({
          pinnedSessionIds: state.pinnedSessionIds.includes(id)
            ? state.pinnedSessionIds.filter((existing) => existing !== id)
            : [id, ...state.pinnedSessionIds],
        })),
    }),
    {
      name: 'linkcode.workbench.sidebar-pinned-threads:v1',
      schema: PersistedPinnedThreadsSchema,
      partialize: (state) => ({ pinnedSessionIds: state.pinnedSessionIds }),
    },
  ),
);

/**
 * Stable partition: pinned sessions first, each side keeping the input's most-recent-first order.
 * Applied before preview truncation so pinned threads always land inside the preview window.
 */
export function orderPinnedFirst(
  sessions: readonly SessionInfo[],
  pinnedIds: readonly SessionId[],
): SessionInfo[] {
  if (pinnedIds.length === 0) return [...sessions];
  const pinned = new Set<SessionId>(pinnedIds);
  return [
    ...sessions.filter((session) => pinned.has(session.sessionId)),
    ...sessions.filter((session) => !pinned.has(session.sessionId)),
  ];
}
