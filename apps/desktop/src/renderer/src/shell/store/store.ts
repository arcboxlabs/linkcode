import { zodPersist } from '@linkcode/common/zustand';
import type { PanelSection, PanelWindowType } from '@linkcode/ui/shell/panels';
import { useTerminalTabsStore } from '@linkcode/workbench';
import { clamp } from 'foxts/clamp';
import { create } from 'zustand';
import type {
  DesktopShellState,
  LayoutState,
  PanelSide,
  PersistedDesktopShellState,
} from './model';
import {
  closeSectionTabState,
  createDefaultDesktopShellState,
  createTab,
  DEFAULT_LAYOUT,
  DESKTOP_SHELL_STORAGE_KEY,
  getExpandedPanel,
  normalizeLayout,
  openFileTabState,
  PersistedDesktopShellStateSchema,
  pushExpandedPanel,
  removeExpandedPanel,
  revealSectionState,
  serializeDesktopShellState,
} from './model';

interface DesktopShellActions {
  updateSidebarOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
  updateLayout: (updater: (current: LayoutState) => LayoutState) => void;
  togglePanel: (side: PanelSide) => void;
  closePanel: (side: PanelSide) => void;
  addWindow: (type: PanelWindowType) => void;
  setActiveBottomTab: (id: string) => void;
  closeTab: (id: string) => void;
  toggleMaxPanel: (side: PanelSide) => void;
  setActiveSection: (section: PanelSection) => void;
  /** Opens the right panel (if closed) and switches it to `section` in one step. */
  openRightPanelSection: (section: PanelSection) => void;
  addRightTerminalTab: () => void;
  closeRightTerminalTab: (id: string) => void;
  setActiveRightTerminalTab: (id: string) => void;
  /** Opens (or re-focuses) a file viewer tab and brings the files section forward. */
  openRightFileTab: (path: string) => void;
  closeRightFileTab: (id: string) => void;
  setActiveRightFileTab: (id: string) => void;
  /** Navigate the in-app browser and bring the browser section forward. */
  openBrowserUrl: (url: string) => void;
  /** Track a navigation that happened inside the webview (keeps the address bar honest). */
  setBrowserUrl: (url: string | null) => void;
  /** Attach a viewer tab for a terminal that already exists on the daemon (script logs). */
  openRightTerminalAttachTab: (terminalId: string) => void;
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

        togglePanel(side) {
          updateShellState((current) => {
            if (side === 'right') {
              const open = !current.rightPanel.open;
              if (open && current.rightPanel.activeSection === 'terminal') {
                useTerminalTabsStore.getState().ensureTab();
              }
              return {
                ...current,
                expansionStack: open
                  ? current.expansionStack
                  : removeExpandedPanel(current.expansionStack, side),
                rightPanel: { ...current.rightPanel, open },
              };
            }

            const panel = current.bottomPanel;
            const open = !panel.open;
            if (open && panel.tabs.length === 0) useTerminalTabsStore.getState().ensureTab();
            return {
              ...current,
              expansionStack: open
                ? current.expansionStack
                : removeExpandedPanel(current.expansionStack, side),
              bottomPanel: {
                ...panel,
                open,
                activeTabId: open && panel.tabs.length === 0 ? null : panel.activeTabId,
              },
            };
          });
        },

        closePanel(side) {
          updateShellState((current) => {
            const expansionStack = removeExpandedPanel(current.expansionStack, side);
            if (side === 'right') {
              return {
                ...current,
                expansionStack,
                rightPanel: { ...current.rightPanel, open: false },
              };
            }
            return {
              ...current,
              expansionStack,
              bottomPanel: { ...current.bottomPanel, open: false },
            };
          });
        },

        addWindow(type) {
          if (type === 'terminal') {
            useTerminalTabsStore.getState().addTab();
            updateShellState((current) => ({
              ...current,
              bottomPanel: { ...current.bottomPanel, open: true, activeTabId: null },
            }));
            return;
          }
          const tab = createTab(type);
          updateShellState((current) => ({
            ...current,
            bottomPanel: {
              ...current.bottomPanel,
              open: true,
              tabs: [...current.bottomPanel.tabs, tab],
              activeTabId: tab.id,
            },
          }));
        },

        setActiveBottomTab(id) {
          const terminalTabs = useTerminalTabsStore.getState();
          if (terminalTabs.tabs.some((tab) => tab.id === id)) {
            terminalTabs.setActiveTab(id);
            updateShellState((current) => ({
              ...current,
              bottomPanel: { ...current.bottomPanel, activeTabId: null },
            }));
            return;
          }
          updateShellState((current) => ({
            ...current,
            bottomPanel: { ...current.bottomPanel, activeTabId: id },
          }));
        },

        closeTab(id) {
          const terminalTabs = useTerminalTabsStore.getState();
          if (terminalTabs.tabs.some((tab) => tab.id === id)) {
            terminalTabs.closeTab(id);
            updateShellState((current) => {
              if (useTerminalTabsStore.getState().tabs.length > 0) return current;
              if (current.bottomPanel.tabs.length === 0) {
                return {
                  ...current,
                  expansionStack: removeExpandedPanel(current.expansionStack, 'bottom'),
                  bottomPanel: { ...current.bottomPanel, open: false, activeTabId: null },
                };
              }
              const fallback = current.bottomPanel.tabs[0];
              return {
                ...current,
                bottomPanel: {
                  ...current.bottomPanel,
                  activeTabId: current.bottomPanel.activeTabId ?? fallback.id,
                },
              };
            });
            return;
          }
          updateShellState((current) => {
            const panel = current.bottomPanel;
            const index = panel.tabs.findIndex((tab) => tab.id === id);
            const tabs = panel.tabs.filter((tab) => tab.id !== id);
            if (tabs.length === 0) {
              if (useTerminalTabsStore.getState().tabs.length > 0) {
                return {
                  ...current,
                  bottomPanel: { ...panel, tabs, activeTabId: null },
                };
              }
              return {
                ...current,
                expansionStack: removeExpandedPanel(current.expansionStack, 'bottom'),
                bottomPanel: { ...panel, open: false, tabs, activeTabId: null },
              };
            }
            const fallback = tabs[clamp(index, 0, tabs.length - 1)];
            return {
              ...current,
              bottomPanel: {
                ...panel,
                tabs,
                activeTabId: panel.activeTabId === id ? fallback.id : panel.activeTabId,
              },
            };
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

        setActiveSection(section) {
          if (section === 'terminal' && get().rightPanel.open) {
            useTerminalTabsStore.getState().ensureTab();
          }
          updateShellState((current) => ({
            ...current,
            rightPanel: revealSectionState(current.rightPanel, section, current.rightPanel.open),
          }));
        },

        openRightPanelSection(section) {
          if (section === 'terminal') useTerminalTabsStore.getState().ensureTab();
          updateShellState((current) => ({
            ...current,
            rightPanel: revealSectionState(current.rightPanel, section, true),
          }));
        },

        addRightTerminalTab() {
          useTerminalTabsStore.getState().addTab();
          updateShellState((current) => ({
            ...current,
            bottomPanel: { ...current.bottomPanel, activeTabId: null },
          }));
        },

        closeRightTerminalTab(id) {
          get().closeTab(id);
        },

        setActiveRightTerminalTab(id) {
          useTerminalTabsStore.getState().setActiveTab(id);
          updateShellState((current) => ({
            ...current,
            bottomPanel: { ...current.bottomPanel, activeTabId: null },
          }));
        },

        openRightFileTab(path) {
          updateShellState((current) => ({
            ...current,
            rightPanel: {
              ...current.rightPanel,
              open: true,
              activeSection: 'files',
              files: openFileTabState(current.rightPanel.files, path),
            },
          }));
        },

        closeRightFileTab(id) {
          updateShellState((current) => ({
            ...current,
            rightPanel: {
              ...current.rightPanel,
              files: closeSectionTabState(current.rightPanel.files, id),
            },
          }));
        },

        setActiveRightFileTab(id) {
          updateShellState((current) => ({
            ...current,
            rightPanel: {
              ...current.rightPanel,
              files: { ...current.rightPanel.files, activeTabId: id },
            },
          }));
        },

        openBrowserUrl(url) {
          updateShellState((current) => ({
            ...current,
            rightPanel: {
              ...current.rightPanel,
              open: true,
              activeSection: 'browser',
              browser: { url },
            },
          }));
        },

        setBrowserUrl(url) {
          updateShellState((current) => ({
            ...current,
            rightPanel: { ...current.rightPanel, browser: { url } },
          }));
        },

        openRightTerminalAttachTab(terminalId) {
          useTerminalTabsStore.getState().openAttachedTab(terminalId);
          updateShellState((current) => ({
            ...current,
            bottomPanel: { ...current.bottomPanel, activeTabId: null },
            rightPanel: {
              ...current.rightPanel,
              open: true,
              activeSection: 'terminal',
            },
          }));
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
      version: 3,
      schema: PersistedDesktopShellStateSchema,
      partialize: serializeDesktopShellState,
    },
  ),
);
