import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedCollapsedGroupsSchema = z
  .object({
    collapsedKeys: z.array(z.string()),
  })
  .partial();
type PersistedCollapsedGroups = z.infer<typeof PersistedCollapsedGroupsSchema>;

export interface SidebarGroupCollapseState {
  /** Group `collapseKey`s (see `ThreadGroup`) currently collapsed. */
  collapsedKeys: string[];
  toggleCollapsed: (key: string) => void;
}

/**
 * Persists which sidebar thread groups are collapsed, keyed by `ThreadGroup.collapseKey` — a
 * workspace's `cwd`, not its `workspaceId` — so the state survives an archive/re-register cycle,
 * which mints a fresh `workspaceId` for the same directory.
 */
export const useSidebarGroupCollapseStore = create<SidebarGroupCollapseState>()(
  zodPersist<SidebarGroupCollapseState, [], [], PersistedCollapsedGroups, PersistedCollapsedGroups>(
    (set) => ({
      collapsedKeys: [],
      toggleCollapsed: (key) =>
        set((state) => ({
          collapsedKeys: state.collapsedKeys.includes(key)
            ? state.collapsedKeys.filter((existing) => existing !== key)
            : [...state.collapsedKeys, key],
        })),
    }),
    {
      name: 'linkcode.workbench.sidebar-collapsed-groups:v1',
      schema: PersistedCollapsedGroupsSchema,
      partialize: (state) => ({ collapsedKeys: state.collapsedKeys }),
    },
  ),
);
