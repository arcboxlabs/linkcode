import { zodPersist } from '@linkcode/common/zustand';
import type { SessionId } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedSidebarOrderSchema = z
  .object({
    groupOrder: z.array(z.string()),
    threadOrder: z.record(z.string(), z.array(SessionIdSchema)),
  })
  .partial();
type PersistedSidebarOrder = z.infer<typeof PersistedSidebarOrderSchema>;

export interface SidebarOrderState {
  /** Manual order of project groups, as `ThreadGroup.collapseKey`s — see `orderGroups`. */
  groupOrder: string[];
  /** Per-group (`collapseKey`) manual thread order — see `orderThreads`/`applyThreadDrag`. */
  threadOrder: Record<string, SessionId[]>;
  setGroupOrder: (keys: string[]) => void;
  setThreadOrder: (groupKey: string, ids: SessionId[]) => void;
}

/**
 * Persists the sidebar's manual drag order, keyed by `collapseKey` (normalized workspace `cwd`)
 * so the order survives an archive/re-register cycle. Ids that no longer exist are harmless —
 * the ordering helpers skip them — so the store never prunes.
 */
export const useSidebarOrderStore = create<SidebarOrderState>()(
  zodPersist<SidebarOrderState, [], [], PersistedSidebarOrder, PersistedSidebarOrder>(
    (set) => ({
      groupOrder: [],
      threadOrder: {},
      setGroupOrder: (keys) => set({ groupOrder: keys }),
      setThreadOrder: (groupKey, ids) =>
        set((state) => ({ threadOrder: { ...state.threadOrder, [groupKey]: ids } })),
    }),
    {
      name: 'linkcode.workbench.sidebar-order:v1',
      schema: PersistedSidebarOrderSchema,
      partialize: (state) => ({ groupOrder: state.groupOrder, threadOrder: state.threadOrder }),
    },
  ),
);
