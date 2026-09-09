import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedDetailWidthSchema = z.object({ width: z.number() }).partial();
type PersistedDetailWidth = z.infer<typeof PersistedDetailWidthSchema>;

export const AUTOMATION_DETAIL_MIN_WIDTH = 420;
export const AUTOMATION_DETAIL_MAX_WIDTH = 960;
export const AUTOMATION_DETAIL_DEFAULT_WIDTH = 640;

interface AutomationDetailWidthState {
  width: number;
  setWidth: (width: number) => void;
  reset: () => void;
}

/** The Automations detail pane's user-resized width, shared across Desktop and Web. */
export const useAutomationDetailWidthStore = create<AutomationDetailWidthState>()(
  zodPersist<AutomationDetailWidthState, [], [], PersistedDetailWidth, PersistedDetailWidth>(
    (set) => ({
      width: AUTOMATION_DETAIL_DEFAULT_WIDTH,
      setWidth: (width) => set({ width }),
      reset: () => set({ width: AUTOMATION_DETAIL_DEFAULT_WIDTH }),
    }),
    {
      name: 'linkcode.automations.detail-width:v1',
      schema: PersistedDetailWidthSchema,
      partialize: (state) => ({ width: state.width }),
    },
  ),
);
