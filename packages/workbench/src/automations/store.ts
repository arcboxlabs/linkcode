import type { LoopId, ScheduleId } from '@linkcode/schema';
import { create } from 'zustand';

/** Which family the Automations surface is browsing. */
export type AutomationTab = 'schedules' | 'loops';

/** What the Automations surface shows in its detail pane. */
export type AutomationsPane =
  | { kind: 'browse' }
  | { kind: 'create-schedule' }
  | { kind: 'create-loop' };

interface AutomationsPaneState {
  tab: AutomationTab;
  /** The schedule shown in the schedules detail pane; null falls back to the first item. */
  selectedScheduleId: ScheduleId | null;
  /** The loop shown in the loops detail pane; null falls back to the first item. */
  selectedLoopId: LoopId | null;
  view: AutomationsPane;
  setTab: (tab: AutomationTab) => void;
  select: (scheduleId: ScheduleId) => void;
  selectLoop: (loopId: LoopId) => void;
  startCreate: () => void;
  startCreateLoop: () => void;
  closeCreate: () => void;
}

/**
 * The Automations surface's ephemeral view state. Module scope (like the palette store) so app
 * edges — the sidebar button, a palette command — can open it and select an automation without
 * threading props through the workbench surface. Not persisted.
 */
export const useAutomationsViewStore = create<AutomationsPaneState>()((set) => ({
  tab: 'schedules',
  selectedScheduleId: null,
  selectedLoopId: null,
  view: { kind: 'browse' },
  setTab: (tab) => set({ tab, view: { kind: 'browse' } }),
  select: (scheduleId) =>
    set({ tab: 'schedules', selectedScheduleId: scheduleId, view: { kind: 'browse' } }),
  selectLoop: (loopId) => set({ tab: 'loops', selectedLoopId: loopId, view: { kind: 'browse' } }),
  startCreate: () => set({ tab: 'schedules', view: { kind: 'create-schedule' } }),
  startCreateLoop: () => set({ tab: 'loops', view: { kind: 'create-loop' } }),
  closeCreate: () => set({ view: { kind: 'browse' } }),
}));

/** Imperative selection, for app-edge triggers that open the surface on a specific schedule. */
export function selectAutomation(scheduleId: ScheduleId): void {
  useAutomationsViewStore.getState().select(scheduleId);
}
