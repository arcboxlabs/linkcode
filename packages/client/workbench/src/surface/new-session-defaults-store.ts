import { zodPersist } from '@linkcode/common/zustand';
import type { AgentKind, WorkspaceId } from '@linkcode/schema';
import { AgentKindSchema, WorkspaceIdSchema } from '@linkcode/schema';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedNewSessionDefaultsSchema = z
  .object({
    lastProvider: AgentKindSchema.nullable(),
    lastWorkspaceId: WorkspaceIdSchema.nullable(),
  })
  .partial();
type PersistedNewSessionDefaults = z.infer<typeof PersistedNewSessionDefaultsSchema>;

export interface NewSessionDefaultsState {
  /** Provider of the last successful new-session submit; null before the first (→ claude-code). */
  lastProvider: AgentKind | null;
  /** Workspace of the last successful submit; ids that no longer exist are skipped at resolve time. */
  lastWorkspaceId: WorkspaceId | null;
  remember: (provider: AgentKind, workspaceId: WorkspaceId) => void;
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
      remember: (provider, workspaceId) =>
        set({ lastProvider: provider, lastWorkspaceId: workspaceId }),
    }),
    {
      name: 'linkcode.workbench.new-session-defaults:v1',
      schema: PersistedNewSessionDefaultsSchema,
      partialize: (state) => ({
        lastProvider: state.lastProvider,
        lastWorkspaceId: state.lastWorkspaceId,
      }),
    },
  ),
);
