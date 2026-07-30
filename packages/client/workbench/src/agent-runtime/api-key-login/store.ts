import type { AgentKind } from '@linkcode/schema';
import { create } from 'zustand';

/**
 * Which agent's API-key login dialog is open. Module-scope, not component state: the onboarding
 * card that opens it lives several prop hops below the workbench, and the dialog is mounted beside
 * the shell rather than inside the card. Not persisted.
 */
interface AgentApiKeyLoginState {
  kind: AgentKind | null;
  open: (kind: AgentKind) => void;
  close: () => void;
}

export const useAgentApiKeyLoginStore = create<AgentApiKeyLoginState>()((set) => ({
  kind: null,
  open: (kind) => set({ kind }),
  close: () => set({ kind: null }),
}));
