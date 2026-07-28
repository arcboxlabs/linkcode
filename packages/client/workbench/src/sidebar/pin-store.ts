import { zodPersist } from '@linkcode/common/zustand';
import type { SessionId } from '@linkcode/schema';
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
  /** Session ids in the sidebar's Pinned section — membership only; display order comes from `orderThreads`. */
  pinnedSessionIds: SessionId[];
  togglePinned: (id: SessionId) => void;
}

/** Persists which threads are pinned in the sidebar. Ids of dead sessions are harmless — they
 * match nothing when ordering — so the store never prunes. */
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
