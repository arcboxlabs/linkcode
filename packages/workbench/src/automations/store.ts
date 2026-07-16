import type { ScheduleId } from '@linkcode/schema';
import { create } from 'zustand';

/** What the Automations surface shows in its detail pane. */
export type AutomationsView = { kind: 'browse' } | { kind: 'create-schedule' };

interface AutomationsViewState {
  /** The schedule shown in the detail pane; null falls back to the first item. */
  selectedScheduleId: ScheduleId | null;
  view: AutomationsView;
  select: (scheduleId: ScheduleId) => void;
  startCreate: () => void;
  closeCreate: () => void;
}

/**
 * The Automations surface's ephemeral view state. Module scope (like the palette store) so app
 * edges — the sidebar button, a palette command — can open it and select a schedule without
 * threading props through the workbench surface. Not persisted.
 */
export const useAutomationsViewStore = create<AutomationsViewState>()((set) => ({
  selectedScheduleId: null,
  view: { kind: 'browse' },
  select: (scheduleId) => set({ selectedScheduleId: scheduleId, view: { kind: 'browse' } }),
  startCreate: () => set({ view: { kind: 'create-schedule' } }),
  closeCreate: () => set({ view: { kind: 'browse' } }),
}));

/** Imperative selection, for app-edge triggers that open the surface on a specific schedule. */
export function selectAutomation(scheduleId: ScheduleId): void {
  useAutomationsViewStore.getState().select(scheduleId);
}
