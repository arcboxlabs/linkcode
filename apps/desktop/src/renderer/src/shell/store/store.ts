import { zodPersist } from '@linkcode/common/zustand';
import type { PanelWindowType } from '@linkcode/ui/shell/panels';
import { clamp } from 'foxts/clamp';
import { create } from 'zustand';
import type {
  DesktopShellState,
  LayoutState,
  PanelSide,
  PanelState,
  PersistedDesktopShellState,
} from './model';
import {
  createDefaultDesktopShellState,
  createTab,
  DEFAULT_LAYOUT,
  DESKTOP_SHELL_STORAGE_KEY,
  defaultWindowFor,
  getExpandedPanel,
  getPanelFromShellState,
  normalizeLayout,
  PersistedDesktopShellStateSchema,
  pushExpandedPanel,
  removeExpandedPanel,
  serializeDesktopShellState,
  setPanelInShellState,
} from './model';

interface DesktopShellActions {
  updateSidebarOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
  updateLayout: (updater: (current: LayoutState) => LayoutState) => void;
  updatePanel: (side: PanelSide, updater: (panel: PanelState) => PanelState) => void;
  togglePanel: (side: PanelSide) => void;
  closePanel: (side: PanelSide) => void;
  addWindow: (side: PanelSide, type: PanelWindowType) => void;
  closeTab: (side: PanelSide, id: string) => void;
  toggleMaxPanel: (side: PanelSide) => void;
  resetSidebarSize: () => void;
  resetRightPanelSize: () => void;
  resetBottomPanelSize: () => void;
}

export type DesktopShellStore = DesktopShellState & DesktopShellActions;

export const useDesktopShellStore = create<DesktopShellStore>()(
  zodPersist<DesktopShellStore, [], [], PersistedDesktopShellState, DesktopShellState>(
    (set, get) => {
      function updateShellState(updater: (current: DesktopShellState) => DesktopShellState): void {
        set(updater);
      }

      return {
        ...createDefaultDesktopShellState(),

        updateSidebarOpen(updater) {
          updateShellState((current) => {
            const sidebarOpen =
              typeof updater === 'function' ? updater(current.sidebarOpen) : updater;
            return { ...current, sidebarOpen };
          });
        },

        updateLayout(updater) {
          updateShellState((current) => ({
            ...current,
            layout: normalizeLayout(updater(current.layout)),
          }));
        },

        updatePanel(side, updater) {
          updateShellState((current) =>
            setPanelInShellState(current, side, updater(getPanelFromShellState(current, side))),
          );
        },

        togglePanel(side) {
          updateShellState((current) => {
            const panel = getPanelFromShellState(current, side);
            const open = !panel.open;
            const tabs = panel.tabs.length > 0 ? panel.tabs : [createTab(defaultWindowFor(side))];
            const nextPanel = {
              ...panel,
              open,
              tabs,
              activeTabId: open ? (panel.activeTabId ?? tabs[0].id) : panel.activeTabId,
            };
            return setPanelInShellState(
              {
                ...current,
                expansionStack: open
                  ? current.expansionStack
                  : removeExpandedPanel(current.expansionStack, side),
              },
              side,
              nextPanel,
            );
          });
        },

        closePanel(side) {
          updateShellState((current) =>
            setPanelInShellState(
              { ...current, expansionStack: removeExpandedPanel(current.expansionStack, side) },
              side,
              { ...getPanelFromShellState(current, side), open: false },
            ),
          );
        },

        addWindow(side, type) {
          const tab = createTab(type);
          updateShellState((current) => {
            const panel = getPanelFromShellState(current, side);
            return setPanelInShellState(current, side, {
              ...panel,
              open: true,
              tabs: [...panel.tabs, tab],
              activeTabId: tab.id,
            });
          });
        },

        closeTab(side, id) {
          updateShellState((current) => {
            const panel = getPanelFromShellState(current, side);
            const index = panel.tabs.findIndex((tab) => tab.id === id);
            const tabs = panel.tabs.filter((tab) => tab.id !== id);
            if (tabs.length === 0) {
              return setPanelInShellState(
                { ...current, expansionStack: removeExpandedPanel(current.expansionStack, side) },
                side,
                { ...panel, open: false, tabs, activeTabId: null },
              );
            }
            const fallback = tabs[clamp(index, 0, tabs.length - 1)];
            return setPanelInShellState(current, side, {
              ...panel,
              tabs,
              activeTabId: panel.activeTabId === id ? fallback.id : panel.activeTabId,
            });
          });
        },

        toggleMaxPanel(side) {
          updateShellState((current) => {
            const activeExpandedPanel = getExpandedPanel(
              current.expansionStack,
              current.rightPanel.open,
              current.bottomPanel.open,
            );

            return {
              ...current,
              expansionStack:
                activeExpandedPanel === side
                  ? removeExpandedPanel(current.expansionStack, side)
                  : pushExpandedPanel(current.expansionStack, side),
            };
          });
        },

        resetSidebarSize() {
          get().updateLayout((current) => ({ ...current, sidebarW: DEFAULT_LAYOUT.sidebarW }));
        },

        resetRightPanelSize() {
          get().updateLayout((current) => ({ ...current, rightW: DEFAULT_LAYOUT.rightW }));
        },

        resetBottomPanelSize() {
          get().updateLayout((current) => ({ ...current, bottomH: DEFAULT_LAYOUT.bottomH }));
        },
      };
    },
    {
      name: DESKTOP_SHELL_STORAGE_KEY,
      version: 1,
      schema: PersistedDesktopShellStateSchema,
      partialize: serializeDesktopShellState,
    },
  ),
);
