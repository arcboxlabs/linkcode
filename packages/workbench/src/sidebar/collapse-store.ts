import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

// Added `collapsedSections` without bumping the persist key: the schema is `.partial()`, so a
// blob written before the field existed still parses and the section state just defaults open.
const PersistedCollapsedGroupsSchema = z
  .object({
    collapsedKeys: z.array(z.string()),
    collapsedSections: z.array(z.enum(['pinned', 'projects', 'chats'])),
  })
  .partial();
type PersistedCollapsedGroups = z.infer<typeof PersistedCollapsedGroupsSchema>;

export type SidebarSection = 'pinned' | 'projects' | 'chats';

export interface SidebarGroupCollapseState {
  /** Group `collapseKey`s (see `ThreadGroup`) currently collapsed. */
  collapsedKeys: string[];
  /** Top-level sidebar sections currently collapsed; all default open. */
  collapsedSections: SidebarSection[];
  toggleCollapsed: (key: string) => void;
  toggleSectionCollapsed: (section: SidebarSection) => void;
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
      collapsedSections: [],
      toggleCollapsed: (key) =>
        set((state) => ({
          collapsedKeys: state.collapsedKeys.includes(key)
            ? state.collapsedKeys.filter((existing) => existing !== key)
            : [...state.collapsedKeys, key],
        })),
      toggleSectionCollapsed: (section) =>
        set((state) => ({
          collapsedSections: state.collapsedSections.includes(section)
            ? state.collapsedSections.filter((existing) => existing !== section)
            : [...state.collapsedSections, section],
        })),
    }),
    {
      name: 'linkcode.workbench.sidebar-collapsed-groups:v1',
      schema: PersistedCollapsedGroupsSchema,
      partialize: (state) => ({
        collapsedKeys: state.collapsedKeys,
        collapsedSections: state.collapsedSections,
      }),
    },
  ),
);
