import type { AgentKind } from '@linkcode/schema';
import { create } from 'zustand';

/**
 * Which agent's API-key setup dialog is open. Module-scope because the Providers method picker and
 * the API-key dialog are sibling overlays. Not persisted.
 */
interface AgentApiKeyLoginState {
  kind: AgentKind | null;
  accountId: string | null;
  open: (kind: AgentKind) => void;
  close: () => void;
}

export const useAgentApiKeyLoginStore = create<AgentApiKeyLoginState>()((set) => ({
  kind: null,
  accountId: null,
  open: (kind) => set({ kind, accountId: `acc_${crypto.randomUUID()}` }),
  close: () => set({ kind: null, accountId: null }),
}));
