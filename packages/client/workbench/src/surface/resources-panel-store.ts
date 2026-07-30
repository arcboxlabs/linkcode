import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedResourcesPanelSchema = z.object({ open: z.boolean() }).partial();
type PersistedResourcesPanel = z.infer<typeof PersistedResourcesPanelSchema>;

export interface ResourcesPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const RESOURCES_FLOATING_COLUMN_WIDTH = 312;
export const RESOURCES_NORMAL_CONTENT_WIDTH = 824;
export const RESOURCES_FLOATING_MIN_WORKSPACE_WIDTH =
  RESOURCES_NORMAL_CONTENT_WIDTH + RESOURCES_FLOATING_COLUMN_WIDTH;

export type ResourcesPanelPresentation = 'hidden' | 'floating' | 'popover';

export function getResourcesPanelPresentation({
  available,
  floatingSpaceAvailable,
  rightPanelOpen = false,
}: {
  available: boolean;
  floatingSpaceAvailable: boolean;
  rightPanelOpen?: boolean;
}): ResourcesPanelPresentation {
  if (!available) return 'hidden';
  return floatingSpaceAvailable && !rightPanelOpen ? 'floating' : 'popover';
}

/** Cross-client surface visibility. Resource data and task execution do not live in this store. */
export const useResourcesPanelStore = create<ResourcesPanelState>()(
  zodPersist<ResourcesPanelState, [], [], PersistedResourcesPanel, PersistedResourcesPanel>(
    (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
      toggle: () => set((state) => ({ open: !state.open })),
    }),
    {
      name: 'linkcode.workbench.resources-panel:v1',
      schema: PersistedResourcesPanelSchema,
      partialize: (state) => ({ open: state.open }),
    },
  ),
);
