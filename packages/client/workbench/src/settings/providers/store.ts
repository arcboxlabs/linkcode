import { create } from 'zustand';

/**
 * View state of the Providers settings page (master/detail + add flow). Module-scope, not
 * component state: the Agents tab jumps here with a pre-selected account, and desktop's Settings
 * sits in the daemon-URL-keyed subtree where component state resets on URL save. Not persisted.
 */
export type ProvidersSettingsView =
  | { kind: 'browse' }
  | { kind: 'add-catalog' }
  | { kind: 'add-form'; service: string }
  | { kind: 'edit' };

interface ProvidersSettingsState {
  /** Selected pool account id; null falls back to the first account. */
  selectedAccountId: string | null;
  view: ProvidersSettingsView;
  select: (id: string) => void;
  startEdit: () => void;
  backToAccount: () => void;
  startAdd: () => void;
  pickService: (service: string) => void;
  backToCatalog: () => void;
  closeAdd: () => void;
}

export const useProvidersSettingsStore = create<ProvidersSettingsState>()((set) => ({
  selectedAccountId: null,
  view: { kind: 'browse' },
  select: (id) => set({ selectedAccountId: id, view: { kind: 'browse' } }),
  startEdit: () => set({ view: { kind: 'edit' } }),
  backToAccount: () => set({ view: { kind: 'browse' } }),
  startAdd: () => set({ view: { kind: 'add-catalog' } }),
  pickService: (service) => set({ view: { kind: 'add-form', service } }),
  backToCatalog: () => set({ view: { kind: 'add-catalog' } }),
  closeAdd: () => set({ view: { kind: 'browse' } }),
}));
