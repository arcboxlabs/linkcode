import { zodPersist } from '@linkcode/common/zustand';
import type { AgentKind } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedUnverifiedRuntimesSchema = z
  .object({
    acknowledged: z.partialRecord(AgentKindSchema, z.string()),
  })
  .partial();
type PersistedUnverifiedRuntimes = z.infer<typeof PersistedUnverifiedRuntimesSchema>;

export interface UnverifiedRuntimesState {
  /** Per agent, the detected out-of-range version the user chose to keep using (CODE-112).
   * Keyed by exact version: an upgrade to a different out-of-range version prompts again. */
  acknowledged: Partial<Record<AgentKind, string>>;
  acknowledge: (kind: AgentKind, version: string) => void;
}

/** Persists "continue with unverified version" picks across restarts (decision: per agent+version). */
export const useUnverifiedRuntimesStore = create<UnverifiedRuntimesState>()(
  zodPersist<
    UnverifiedRuntimesState,
    [],
    [],
    PersistedUnverifiedRuntimes,
    PersistedUnverifiedRuntimes
  >(
    (set) => ({
      acknowledged: {},
      acknowledge: (kind, version) =>
        set((state) => ({ acknowledged: { ...state.acknowledged, [kind]: version } })),
    }),
    {
      name: 'linkcode.workbench.unverified-runtimes:v1',
      schema: PersistedUnverifiedRuntimesSchema,
      partialize: (state) => ({ acknowledged: state.acknowledged }),
    },
  ),
);
