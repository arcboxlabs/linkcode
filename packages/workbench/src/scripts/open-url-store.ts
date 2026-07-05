import { zodPersist } from '@linkcode/common/zustand';
import { z } from 'zod';
import { create } from 'zustand';

export type OpenUrlBehavior = 'ask' | 'in-app' | 'external';

const PersistedOpenUrlSchema = z
  .object({
    behavior: z.enum(['ask', 'in-app', 'external']),
  })
  .partial();
type PersistedOpenUrl = z.infer<typeof PersistedOpenUrlSchema>;

export interface OpenUrlPreferenceState {
  /** How preview links open on hosts that have an in-app browser (paseo's serviceUrlBehavior). */
  behavior: OpenUrlBehavior;
  setBehavior: (behavior: OpenUrlBehavior) => void;
}

export const useOpenUrlPreferenceStore = create<OpenUrlPreferenceState>()(
  zodPersist<OpenUrlPreferenceState, [], [], PersistedOpenUrl, PersistedOpenUrl>(
    (set) => ({
      behavior: 'ask',
      setBehavior: (behavior) => set({ behavior }),
    }),
    {
      name: 'linkcode.workbench.preview-open-url:v1',
      schema: PersistedOpenUrlSchema,
      partialize: (state) => ({ behavior: state.behavior }),
    },
  ),
);
