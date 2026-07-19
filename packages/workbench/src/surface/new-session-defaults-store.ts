import { zodPersist } from '@linkcode/common/zustand';
import type { AgentKind, EffortLevel, WorkspaceId } from '@linkcode/schema';
import { AgentKindSchema, EffortLevelSchema, WorkspaceIdSchema } from '@linkcode/schema';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedNewSessionDefaultsSchema = z
  .object({
    lastProvider: AgentKindSchema.nullable(),
    lastWorkspaceId: WorkspaceIdSchema.nullable(),
    effortsByProvider: z.partialRecord(AgentKindSchema, EffortLevelSchema),
  })
  .partial();
type PersistedNewSessionDefaults = z.infer<typeof PersistedNewSessionDefaultsSchema>;

export interface NewSessionDefaultsState {
  /** Provider of the last successful new-session submit; null before the first (→ claude-code). */
  lastProvider: AgentKind | null;
  /** Workspace of the last successful submit; ids that no longer exist are skipped at resolve time. */
  lastWorkspaceId: WorkspaceId | null;
  /** Last successfully applied effort per provider; absent means defer to the provider default. */
  effortsByProvider: Partial<Record<AgentKind, EffortLevel>>;
  remember: (provider: AgentKind, workspaceId: WorkspaceId, effort?: EffortLevel) => void;
  rememberEffort: (provider: AgentKind, effort: EffortLevel) => void;
}

/** Persists the new-session page's defaults, so the next draft preselects the last-used picks. */
export const useNewSessionDefaultsStore = create<NewSessionDefaultsState>()(
  zodPersist<
    NewSessionDefaultsState,
    [],
    [],
    PersistedNewSessionDefaults,
    PersistedNewSessionDefaults
  >(
    (set) => ({
      lastProvider: null,
      lastWorkspaceId: null,
      effortsByProvider: {},
      remember: (provider, workspaceId, effort) =>
        set((state) => ({
          lastProvider: provider,
          lastWorkspaceId: workspaceId,
          effortsByProvider:
            effort === undefined
              ? state.effortsByProvider
              : { ...state.effortsByProvider, [provider]: effort },
        })),
      rememberEffort: (provider, effort) =>
        set((state) => ({
          effortsByProvider: { ...state.effortsByProvider, [provider]: effort },
        })),
    }),
    {
      name: 'linkcode.workbench.new-session-defaults:v2',
      schema: PersistedNewSessionDefaultsSchema,
      partialize: (state) => ({
        lastProvider: state.lastProvider,
        lastWorkspaceId: state.lastWorkspaceId,
        effortsByProvider: state.effortsByProvider,
      }),
    },
  ),
);
