import type { LoopId, ScheduleId } from '@linkcode/schema';
import { create } from 'zustand';
import { useAutomationDraftState } from './draft-state';

const navigate = (action: () => void): void => useAutomationDraftState.getState().request(action);

/** Which family the Automations surface is browsing. */
export type AutomationTab = 'schedules' | 'loops';

/** What the Automations surface shows in its detail pane. */
export type AutomationsPane =
  | { kind: 'browse' }
  | { kind: 'create-schedule' }
  | { kind: 'create-loop' };

interface AutomationsPaneState {
  scheduleFilter: 'all' | 'active' | 'paused' | 'completed';
  loopFilter: 'all' | 'running' | 'finished';
  queries: Record<AutomationTab, string>;
  setScheduleFilter: (filter: AutomationsPaneState['scheduleFilter']) => void;
  setLoopFilter: (filter: AutomationsPaneState['loopFilter']) => void;
  setQuery: (tab: AutomationTab, query: string) => void;
  tab: AutomationTab;
  /** The schedule shown in the schedules detail pane; null keeps the list collapsed. */
  selectedScheduleId: ScheduleId | null;
  /** The loop shown in the loops detail pane; null keeps the list collapsed. */
  selectedLoopId: LoopId | null;
  view: AutomationsPane;
  setTab: (tab: AutomationTab) => void;
  select: (scheduleId: ScheduleId) => void;
  selectLoop: (loopId: LoopId) => void;
  startCreate: () => void;
  startCreateLoop: () => void;
  closeCreate: () => void;
  collapse: () => void;
}

/**
 * The Automations surface's ephemeral view state. Module scope (like the palette store) so app
 * edges — the sidebar button, a palette command — can open it and select an automation without
 * threading props through the workbench surface. Not persisted.
 */
export const useAutomationsViewStore = create<AutomationsPaneState>()((set, get) => ({
  scheduleFilter: 'all',
  loopFilter: 'all',
  queries: { schedules: '', loops: '' },
  setScheduleFilter: (scheduleFilter) => set({ scheduleFilter }),
  setLoopFilter: (loopFilter) => set({ loopFilter }),
  setQuery: (tab, query) => set((state) => ({ queries: { ...state.queries, [tab]: query } })),
  tab: 'schedules',
  selectedScheduleId: null,
  selectedLoopId: null,
  view: { kind: 'browse' },
  setTab(tab) {
    if (get().tab === tab) return;
    navigate(() => set({ tab, view: { kind: 'browse' } }));
  },
  select(scheduleId) {
    const state = get();
    if (
      state.tab === 'schedules' &&
      state.view.kind === 'browse' &&
      state.selectedScheduleId === scheduleId
    ) {
      return;
    }
    navigate(() =>
      set({ tab: 'schedules', selectedScheduleId: scheduleId, view: { kind: 'browse' } }),
    );
  },
  selectLoop(loopId) {
    const state = get();
    if (state.tab === 'loops' && state.view.kind === 'browse' && state.selectedLoopId === loopId) {
      return;
    }
    navigate(() => set({ tab: 'loops', selectedLoopId: loopId, view: { kind: 'browse' } }));
  },
  startCreate() {
    if (get().view.kind === 'create-schedule') return;
    navigate(() => set({ tab: 'schedules', view: { kind: 'create-schedule' } }));
  },
  startCreateLoop() {
    if (get().view.kind === 'create-loop') return;
    navigate(() => set({ tab: 'loops', view: { kind: 'create-loop' } }));
  },
  closeCreate: () => set({ view: { kind: 'browse' } }),
  collapse: () =>
    navigate(() =>
      set((state) =>
        state.tab === 'schedules'
          ? { selectedScheduleId: null, view: { kind: 'browse' } }
          : { selectedLoopId: null, view: { kind: 'browse' } },
      ),
    ),
}));

/** Imperative selection, for app-edge triggers that open the surface on a specific schedule. */
export function selectAutomation(scheduleId: ScheduleId): void {
  useAutomationsViewStore.getState().select(scheduleId);
}
