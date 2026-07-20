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
  | { kind: 'edit'; accountId: string };

interface ProvidersSettingsState {
  /** Selected pool account id; null falls back to the first account. */
  selectedAccountId: string | null;
  view: ProvidersSettingsView;
  select: (id: string) => void;
  startAdd: () => void;
  pickService: (service: string) => void;
  backToCatalog: () => void;
  startEdit: (accountId: string) => void;
  /** Leave the add or edit pane, back to browsing the selected account. */
  closeAdd: () => void;
}

export const useProvidersSettingsStore = create<ProvidersSettingsState>()((set) => ({
  selectedAccountId: null,
  view: { kind: 'browse' },
  select: (id) => set({ selectedAccountId: id, view: { kind: 'browse' } }),
  startAdd: () => set({ view: { kind: 'add-catalog' } }),
  pickService: (service) => set({ view: { kind: 'add-form', service } }),
  backToCatalog: () => set({ view: { kind: 'add-catalog' } }),
  startEdit: (accountId) =>
    set({ selectedAccountId: accountId, view: { kind: 'edit', accountId } }),
  closeAdd: () => set({ view: { kind: 'browse' } }),
}));
