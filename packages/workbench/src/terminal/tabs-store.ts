import { zodPersist } from '@linkcode/common/zustand';
import { clamp } from 'foxts/clamp';
import { createFixedArray } from 'foxts/create-fixed-array';
import { z } from 'zod';
import { create } from 'zustand';

export interface TerminalTab {
  id: string;
}

export interface TerminalTabsState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

interface TerminalTabsStore extends TerminalTabsState {
  ensureTab: () => string;
  addTab: () => string;
  openAttachedTab: (terminalId: string) => string;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
}

interface PersistedTerminalTabsState {
  version: 1;
  tabCount: number;
  activeTabIndex: number;
}

const MAX_PERSISTED_TABS = 20;
let tabSequence = 0;

export function createTerminalTab(): TerminalTab {
  tabSequence += 1;
  return { id: `terminal-${tabSequence}` };
}

export function closeTerminalTabState(state: TerminalTabsState, id: string): TerminalTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const activeTabId =
    state.activeTabId === id
      ? (tabs[clamp(index, 0, tabs.length - 1)]?.id ?? null)
      : state.activeTabId;
  return { tabs, activeTabId };
}

export function createDefaultTerminalTabsState(): TerminalTabsState {
  const tab = createTerminalTab();
  return { tabs: [tab], activeTabId: tab.id };
}

const PersistedTerminalTabsStateSchema = z
  .object({
    version: z.literal(1),
    tabCount: z.number().int().nonnegative().catch(1),
    activeTabIndex: z.number().int().catch(0),
  })
  .transform(({ tabCount, activeTabIndex }): TerminalTabsState => {
    const tabs = createFixedArray(clamp(tabCount, 0, MAX_PERSISTED_TABS)).map(createTerminalTab);
    return {
      tabs,
      activeTabId: tabs[clamp(activeTabIndex, 0, tabs.length - 1)]?.id ?? null,
    };
  });

export const useTerminalTabsStore = create<TerminalTabsStore>()(
  zodPersist<TerminalTabsStore, [], [], PersistedTerminalTabsState, TerminalTabsState>(
    (set, get) => ({
      ...createDefaultTerminalTabsState(),
      ensureTab() {
        const current = get();
        if (current.tabs.length > 0) {
          const id = current.activeTabId ?? current.tabs[0].id;
          if (current.activeTabId === null) set({ activeTabId: id });
          return id;
        }
        return get().addTab();
      },
      addTab() {
        const tab = createTerminalTab();
        set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
        return tab.id;
      },
      openAttachedTab(terminalId) {
        const id = `attach:${terminalId}`;
        set((state) => ({
          tabs: state.tabs.some((tab) => tab.id === id) ? state.tabs : [...state.tabs, { id }],
          activeTabId: id,
        }));
        return id;
      },
      setActiveTab(id) {
        if (get().tabs.some((tab) => tab.id === id)) set({ activeTabId: id });
      },
      closeTab(id) {
        set((state) => closeTerminalTabState(state, id));
      },
    }),
    {
      name: 'linkcode.workbench.terminal-tabs:v1',
      version: 1,
      schema: PersistedTerminalTabsStateSchema,
      partialize(state) {
        // Attached terminals are owned by another runtime (for example a script log PTY) and
        // cannot be recreated after a renderer restart. Persist only shell tabs we can reopen.
        const tabs = state.tabs.filter((tab) => !tab.id.startsWith('attach:'));
        return {
          version: 1,
          tabCount: tabs.length,
          activeTabIndex: clamp(
            tabs.findIndex((tab) => tab.id === state.activeTabId),
            0,
            Math.max(0, tabs.length - 1),
          ),
        };
      },
    },
  ),
);
