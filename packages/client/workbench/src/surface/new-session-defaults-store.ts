import { zodPersist } from '@linkcode/common/zustand';
import type { AgentKind, BranchSelection, EffortLevel, WorkspaceId } from '@linkcode/schema';
import {
  AgentKindSchema,
  BranchSelectionSchema,
  EffortLevelSchema,
  WorkspaceIdSchema,
} from '@linkcode/schema';
import { z } from 'zod';
import { create } from 'zustand';

const PersistedNewSessionDefaultsSchema = z
  .object({
    lastProvider: AgentKindSchema.nullable(),
    lastWorkspaceId: WorkspaceIdSchema.nullable(),
    modelsByProvider: z.partialRecord(AgentKindSchema, z.string().min(1)),
    effortsByProvider: z.partialRecord(AgentKindSchema, EffortLevelSchema),
    branchesByWorkspace: z.record(z.string(), BranchSelectionSchema),
  })
  .partial();
type PersistedNewSessionDefaults = z.infer<typeof PersistedNewSessionDefaultsSchema>;

export interface NewSessionSelection {
  /** Null clears a remembered selection after an explicit reset or rejected reflection. */
  model?: string | null;
  /** Null clears a remembered selection after an explicit reset or rejected reflection. */
  effort?: EffortLevel | null;
}

export interface NewSessionDefaultsState {
  /** Provider of the last successful new-session submit; null before the first (→ claude-code). */
  lastProvider: AgentKind | null;
  /** Workspace of the last successful submit; ids that no longer exist are skipped at resolve time. */
  lastWorkspaceId: WorkspaceId | null;
  /** Last model accepted by LinkCode per provider; absent means defer to configured defaults. */
  modelsByProvider: Partial<Record<AgentKind, string>>;
  /** Last effort accepted by LinkCode per provider; absent means defer to the provider default. */
  effortsByProvider: Partial<Record<AgentKind, EffortLevel>>;
  /** Last explicitly selected branch per workspace. */
  branchesByWorkspace: Record<string, BranchSelection>;
  remember: (
    provider: AgentKind,
    workspaceId: WorkspaceId,
    selection: NewSessionSelection,
    branch?: BranchSelection,
  ) => void;
  rememberSelection: (provider: AgentKind, selection: NewSessionSelection) => void;
}

function selectionPatch(
  state: NewSessionDefaultsState,
  provider: AgentKind,
  selection: NewSessionSelection,
): Pick<NewSessionDefaultsState, 'modelsByProvider' | 'effortsByProvider'> {
  let modelsByProvider = state.modelsByProvider;
  if (selection.model !== undefined) {
    modelsByProvider = { ...modelsByProvider };
    if (selection.model === null) Reflect.deleteProperty(modelsByProvider, provider);
    else modelsByProvider[provider] = selection.model;
  }

  let effortsByProvider = state.effortsByProvider;
  if (selection.effort !== undefined) {
    effortsByProvider = { ...effortsByProvider };
    if (selection.effort === null) Reflect.deleteProperty(effortsByProvider, provider);
    else effortsByProvider[provider] = selection.effort;
  }

  return {
    modelsByProvider,
    effortsByProvider,
  };
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
      modelsByProvider: {},
      effortsByProvider: {},
      branchesByWorkspace: {},
      remember: (provider, workspaceId, selection, branch) =>
        set((state) => ({
          ...selectionPatch(state, provider, selection),
          lastProvider: provider,
          lastWorkspaceId: workspaceId,
          branchesByWorkspace:
            branch === undefined
              ? state.branchesByWorkspace
              : { ...state.branchesByWorkspace, [workspaceId]: branch },
        })),
      rememberSelection: (provider, selection) =>
        set((state) => selectionPatch(state, provider, selection)),
    }),
    {
      name: 'linkcode.workbench.new-session-defaults:v5',
      schema: PersistedNewSessionDefaultsSchema,
      partialize: (state) => ({
        lastProvider: state.lastProvider,
        lastWorkspaceId: state.lastWorkspaceId,
        modelsByProvider: state.modelsByProvider,
        effortsByProvider: state.effortsByProvider,
        branchesByWorkspace: state.branchesByWorkspace,
      }),
    },
  ),
);
