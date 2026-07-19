import { zodPersist } from '@linkcode/common/zustand';
import type { PanelSection, PanelWindowType } from '@linkcode/ui/shell/panels';
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
  closeSectionTabState,
  createDefaultDesktopShellState,
  createRightTerminalTab,
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
  seedTerminalSection,
  serializeDesktopShellState,
} from './model';

/** The bottom panel's window type when it needs to seed a first tab. */
const DEFAULT_BOTTOM_WINDOW_TYPE: PanelWindowType = 'terminal';

interface DesktopShellActions {
  updateSidebarOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
  updateLayout: (updater: (current: LayoutState) => LayoutState) => void;
  /** Bottom panel only — the right panel's tabs live under its terminal section instead. */
  updatePanel: (updater: (panel: PanelState) => PanelState) => void;
  togglePanel: (side: PanelSide) => void;
  closePanel: (side: PanelSide) => void;
  addWindow: (type: PanelWindowType) => void;
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

        updatePanel(updater) {
          updateShellState((current) => ({
            ...current,
            bottomPanel: updater(current.bottomPanel),
          }));
        },

        togglePanel(side) {
          updateShellState((current) => {
            if (side === 'right') {
              const open = !current.rightPanel.open;
              return {
                ...current,
                expansionStack: open
                  ? current.expansionStack
                  : removeExpandedPanel(current.expansionStack, side),
                rightPanel: {
                  ...current.rightPanel,
                  open,
                  terminal:
                    open && current.rightPanel.activeSection === 'terminal'
                      ? seedTerminalSection(current.rightPanel.terminal)
                      : current.rightPanel.terminal,
                },
              };
            }

            const panel = current.bottomPanel;
            const open = !panel.open;
            const tabs =
              panel.tabs.length > 0 ? panel.tabs : [createTab(DEFAULT_BOTTOM_WINDOW_TYPE)];
            return {
              ...current,
              expansionStack: open
                ? current.expansionStack
                : removeExpandedPanel(current.expansionStack, side),
              bottomPanel: {
                ...panel,
                open,
                tabs,
                activeTabId: open ? (panel.activeTabId ?? tabs[0].id) : panel.activeTabId,
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

        closeTab(id) {
          updateShellState((current) => {
            const panel = current.bottomPanel;
            const index = panel.tabs.findIndex((tab) => tab.id === id);
            const tabs = panel.tabs.filter((tab) => tab.id !== id);
            if (tabs.length === 0) {
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
          updateShellState((current) => ({
            ...current,
            rightPanel: revealSectionState(current.rightPanel, section, current.rightPanel.open),
          }));
        },

        openRightPanelSection(section) {
          updateShellState((current) => ({
            ...current,
            rightPanel: revealSectionState(current.rightPanel, section, true),
          }));
        },

        addRightTerminalTab() {
          const tab = createRightTerminalTab();
          updateShellState((current) => ({
            ...current,
            rightPanel: {
              ...current.rightPanel,
              terminal: {
                tabs: [...current.rightPanel.terminal.tabs, tab],
                activeTabId: tab.id,
              },
            },
          }));
        },

        closeRightTerminalTab(id) {
          updateShellState((current) => ({
            ...current,
            rightPanel: {
              ...current.rightPanel,
              terminal: closeSectionTabState(current.rightPanel.terminal, id),
            },
          }));
        },

        setActiveRightTerminalTab(id) {
          updateShellState((current) => ({
            ...current,
            rightPanel: {
              ...current.rightPanel,
              terminal: { ...current.rightPanel.terminal, activeTabId: id },
            },
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
          const id = `attach:${terminalId}`;
          updateShellState((current) => {
            const terminal = current.rightPanel.terminal;
            const tabs = terminal.tabs.some((tab) => tab.id === id)
              ? terminal.tabs
              : [...terminal.tabs, { id }];
            return {
              ...current,
              rightPanel: {
                ...current.rightPanel,
                open: true,
                activeSection: 'terminal',
                terminal: { tabs, activeTabId: id },
              },
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
      version: 2,
      schema: PersistedDesktopShellStateSchema,
      partialize: serializeDesktopShellState,
    },
  ),
);
