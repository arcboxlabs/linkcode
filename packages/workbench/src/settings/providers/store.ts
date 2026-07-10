import { create } from 'zustand';

/**
 * View state of the Providers settings page (master/detail + the add flow that takes over the
 * detail pane). A module-scope store, not component state: the Agents tab jumps here with a
 * pre-selected account, and on desktop the Settings surface lives inside the daemon-URL-keyed
 * connection subtree, where component state would reset when a new URL is saved. Not persisted.
 */
export type ProvidersSettingsView =
  | { kind: 'browse' }
  | { kind: 'add-catalog' }
  | { kind: 'add-form'; service: string };

interface ProvidersSettingsState {
  /** Selected pool account id; null falls back to the first account. */
  selectedAccountId: string | null;
  view: ProvidersSettingsView;
  select: (id: string) => void;
  startAdd: () => void;
  pickService: (service: string) => void;
  backToCatalog: () => void;
  closeAdd: () => void;
}

export const useProvidersSettingsStore = create<ProvidersSettingsState>()((set) => ({
  selectedAccountId: null,
  view: { kind: 'browse' },
  select: (id) => set({ selectedAccountId: id, view: { kind: 'browse' } }),
  startAdd: () => set({ view: { kind: 'add-catalog' } }),
  pickService: (service) => set({ view: { kind: 'add-form', service } }),
  backToCatalog: () => set({ view: { kind: 'add-catalog' } }),
  closeAdd: () => set({ view: { kind: 'browse' } }),
}));
