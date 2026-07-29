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

/** Web shell-only panel visibility. Resource data and task execution do not live in this store. */
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
