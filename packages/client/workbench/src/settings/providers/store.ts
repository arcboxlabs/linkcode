import type { AgentKind } from '@linkcode/schema';
import { create } from 'zustand';

/**
 * Dialog state of the Providers settings page. Module-scope, not component state: the Agents tab
 * jumps here and opens its bound account, and desktop's Settings sits in the daemon-URL-keyed
 * subtree where component state resets on URL save. Not persisted.
 */
export type ProvidersSettingsView =
  | { kind: 'browse' }
  | { kind: 'add-catalog' }
  | { kind: 'add-form'; service: string }
  | { kind: 'agent-setup'; agent: AgentKind }
  | { kind: 'agent-login'; agent: AgentKind }
  | { kind: 'account'; accountId: string; editing: boolean };

interface ProvidersSettingsState {
  view: ProvidersSettingsView;
  /** Open an account's management dialog. */
  select: (id: string) => void;
  startEdit: () => void;
  backToAccount: () => void;
  startAdd: () => void;
  startAgentSetup: (agent: AgentKind) => void;
  startAgentLogin: (agent: AgentKind) => void;
  pickService: (service: string) => void;
  backToCatalog: () => void;
  closeDialog: () => void;
}

export const useProvidersSettingsStore = create<ProvidersSettingsState>()((set) => ({
  view: { kind: 'browse' },
  select: (id) => set({ view: { kind: 'account', accountId: id, editing: false } }),
  startEdit: () =>
    set((state) =>
      state.view.kind === 'account'
        ? { view: { ...state.view, editing: true } }
        : { view: state.view },
    ),
  backToAccount: () =>
    set((state) =>
      state.view.kind === 'account'
        ? { view: { ...state.view, editing: false } }
        : { view: state.view },
    ),
  startAdd: () => set({ view: { kind: 'add-catalog' } }),
  startAgentSetup: (agent) => set({ view: { kind: 'agent-setup', agent } }),
  startAgentLogin: (agent) => set({ view: { kind: 'agent-login', agent } }),
  pickService: (service) => set({ view: { kind: 'add-form', service } }),
  backToCatalog: () => set({ view: { kind: 'add-catalog' } }),
  closeDialog: () => set({ view: { kind: 'browse' } }),
}));
