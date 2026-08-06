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

/**
 * Exported so tests cannot drift from it — one did, and a silent key mismatch turned the
 * malformed-blob test into a vacuous pass.
 *
 * v6 dropped `modelsByProvider` (the model pick moved to daemon config) and v7 renamed
 * `lastProvider` to `lastHarness`; a stale blob is discarded by the schema either way.
 */
export const NEW_SESSION_DEFAULTS_STORAGE_KEY = 'linkcode.workbench.new-session-defaults:v7';

const PersistedNewSessionDefaultsSchema = z
  .object({
    lastHarness: AgentKindSchema.nullable(),
    lastWorkspaceId: WorkspaceIdSchema.nullable(),
    effortsByProvider: z.partialRecord(AgentKindSchema, EffortLevelSchema),
    branchesByWorkspace: z.record(z.string(), BranchSelectionSchema),
  })
  .partial();
type PersistedNewSessionDefaults = z.infer<typeof PersistedNewSessionDefaultsSchema>;

export interface NewSessionSelection {
  /** Confirmed model, for callers that route it onward. This store does not persist it — the model
   * an agent runs on lives in daemon config (`usePersistPickedModel`), so there is one owner. */
  model?: string | null;
  /** Null clears a remembered selection after an explicit reset or rejected reflection. */
  effort?: EffortLevel | null;
}

export interface NewSessionDefaultsState {
  /** Provider of the last successful new-session submit; null before the first (→ claude-code). */
  lastHarness: AgentKind | null;
  /** Workspace of the last successful submit; ids that no longer exist are skipped at resolve time. */
  lastWorkspaceId: WorkspaceId | null;
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
): Pick<NewSessionDefaultsState, 'effortsByProvider'> {
  let effortsByProvider = state.effortsByProvider;
  if (selection.effort !== undefined) {
    effortsByProvider = { ...effortsByProvider };
    if (selection.effort === null) Reflect.deleteProperty(effortsByProvider, provider);
    else effortsByProvider[provider] = selection.effort;
  }

  return { effortsByProvider };
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
      lastHarness: null,
      lastWorkspaceId: null,
      effortsByProvider: {},
      branchesByWorkspace: {},
      remember: (provider, workspaceId, selection, branch) =>
        set((state) => ({
          ...selectionPatch(state, provider, selection),
          lastHarness: provider,
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
      name: NEW_SESSION_DEFAULTS_STORAGE_KEY,
      schema: PersistedNewSessionDefaultsSchema,
      partialize: (state) => ({
        lastHarness: state.lastHarness,
        lastWorkspaceId: state.lastWorkspaceId,
        effortsByProvider: state.effortsByProvider,
        branchesByWorkspace: state.branchesByWorkspace,
      }),
    },
  ),
);
